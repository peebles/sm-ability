const {Ability} = require( 'casl/packages/casl-ability' );
const _get = require( 'lodash.get' );
const _find = require( 'lodash.find' );
const _intersection = require( 'lodash.intersection' );
const _indexOf = require( 'lodash.indexof' );
const _cloneDeep = require( 'lodash.clonedeep' );

/*
   There are three objects that are associated with entities; 
   users:    belong to one entity
   entities: belong to an entity and have many entities (tree)
   patients: belong to many entities (list)

   A user can potentially manage other users, entities and patients.  Rules for allowing
   these manipulations depend on entity membership.

   Does the subject belong to the same entity as the user? BELONGS_TO_ENTITY
     subject is a user? subject.entity.id === user.entity.id
     subject is an entity? subject.id === user.entity.id
     subject is a patient? user.entity.id in subject.entityIds

   The user belongs to an entity, but there is potentially a tree of entities
   below the user's entity, and this user may be able to manage subjects that below to
   entities at or below the user's entity.  The two interesting cases are; in the user's
   entitiy or in direct children entities, OR in the user's entity or in any entitiy all
   the way down the tree.  Both of these scopes start out with the membership
   check above and then:

   One level check: BELONGS_TO_SUB_ENTITIES
     - userEntityIds = user.entity.entities.map(id)
     subject is a user? subject.entity.id in userEntityIds
     subject is an entity? subject.id in userEntityIds
     subject os a patient? any subject.entityIds in userEntityIds

   Deep check: BELONGS_TO_ENTITY_TREE
     - userEntityIds = recursive capture of entity ids all the way down
     (checks same as above)

   Caregiver checks

   A patient can have multiple care givers; one and only one can be a primary
   caregiver.  So we need 

   IS_PRIMARY_CAREGIVER: user.id is equal to patient caregiverId (this is now the primary)
   IS_CAREGIVER: IS_PRIMARY_CAREGIVER or user.id is in patient.caregiverIds

 */

/*

   Assumed Data Model

   Patient:

   {
     caregiverId: string, // this is a userId from UMS, not a native relation PRIMARY CAREGIVER
     caregiverIds: string[],  // other caregivers, not including the primary
     entityIds: string[], // entityIds from UMS, not native relations
     ...
   }

   When performing an ability check (can()) on a subject that is being *added* then you must 
   include artificial fields that can be used to perform the checks:

   Patient: caregiverId, entityId
   Entity: entityId
   User: entityId

   These artifial fields can be discarded after the check.  Or you could do something like this:

     user.ability.can( 'create', 
       [{
          ...patientData,
          caregiverId: user.id,
          entityID: user.entity.id,
        }, 
        'Patient'
       ]
     );
 */


const IS_PRIMARY_CAREGIVER = (user, patient, rule) => {
  return user.id === patient.caregiverId;
}

const IS_CAREGIVER = (user, patient, rule) => {
  if ( IS_PRIMARY_CAREGIVER(user, patient, rule) ) return true;
  // If we're adding a new patient, it will not have caregivers yet
  if ( ! patient.caregiverIds ) return false;
  let caregiverIds = patient.caregiverIds;
  return _indexOf(caregiverIds, user.id) === -1 ? false : true;
}

const BELONGS_TO_ENTITY = (user, subject, rule) => {
  let subjectEntityId;
  switch( rule.subject ) {
    case 'User':
      subjectEntityId = subject.entityId || subject.entity.id; // support create, modify
      return user.entity.id === subjectEntityId;
      break;
    case 'Entity':
      subjectEntityId = subject.entityId || subject.id; // support create, modify
      return user.entity.id === subjectEntityId;
      break;
    case 'Patient':
      let subjectEntityIds = subject.entityId ? [ subject.entityId ] : subject.entityIds;
      return _indexOf(subjectEntityIds, user.entity.id) === -1 ? false : true;
      break;
    default:
      throw new Error(`unsupported subject "${rule.subject}"`);
  }
}

// Helper function to get entity ids recursively for a entity tree
const _getIds = (entity, ids, levels, level) => {
  ids.push( entity.id );
  if ( ! ( entity.entities && entity.entities.length ) ) return;
  //console.log( entity.name, levels, level );
  if ( level === levels ) return;
  entity.entities.forEach( e => _getIds(e, ids, levels, level+1) );
}

// Common function to check for hierarchitcal entity membership
const _entityMembership = (userEntityIds, subject, rule) => {
  //console.log( 'Entities:', userEntityIds.join(', ') );
  let subjectEntityId;
  switch( rule.subject ) {
    case 'User':
      subjectEntityId = subject.entityId || subject.entity.id; // support create, modify
      return _indexOf(userEntityIds, subjectEntityId) === -1 ? false : true;
      break;
    case 'Entity':
      subjectEntityId = subject.entityId || subject.id; // support create, modify
      return _indexOf(userEntityIds, subjectEntityId) === -1 ? false : true;
      break;
    case 'Patient':
      let subjectEntityIds = subject.entityId ? [ subject.entityId ] : subject.entityIds;
      return _intersection(userEntityIds, subjectEntityIds).length ? true : false;
      break;
    default:
      throw new Error(`unsupported subject "${rule.subject}"`);
  }
}

const BELONGS_TO_SUB_ENTITIES = (user, subject, rule) => {
  if ( BELONGS_TO_ENTITY(user, subject, rule) ) return true;
  let userEntityIds = [];
  _getIds( user.entity, userEntityIds, 1, 0 );
  return _entityMembership(userEntityIds, subject, rule);
}

const BELONGS_TO_ENTITY_TREE = (user, subject, rule) => {
  if ( BELONGS_TO_ENTITY(user, subject, rule) ) return true;
  let userEntityIds = [];
  _getIds( user.entity, userEntityIds, 10000, 0 ); // there will never be 10,000 levels or hierarchy, right?
  return _entityMembership(userEntityIds, subject, rule);
}

const SCOPE_FUNCTIONS = {
  IS_PRIMARY_CAREGIVER,
  IS_CAREGIVER,
  BELONGS_TO_ENTITY,
  BELONGS_TO_SUB_ENTITIES,
  BELONGS_TO_ENTITY_TREE,
};

const resolveVariables = (json, variables) => {
  let template = JSON.stringify(json);
  return JSON.parse(template, (key, rawValue) => {
    if (rawValue[0] !== '$') {
      return rawValue;
    }

    const name = rawValue.slice(2, -1);
    const value = _get(variables, name);

    if (typeof value === 'undefined') {
      throw new Error(`Variable ${name} is not defined`);
    }

    return value;
  });
}

const decorate = (user) => {
  let permissions = [];
  user.roles.forEach((role) => {
    permissions = permissions.concat(role.permissions);
  });
  
  // Replace scope names with functions
  permissions = permissions.map((p) => {
    if ( p.conditions )
      p.conditions = resolveVariables(p.conditions, {user});
    if ( ! p.scope ) return p;
    let fcnNames = Array.isArray(p.scope) ? p.scope : [ p.scope ];
    fcnNames.forEach((fcnName) => {
      if ( ! SCOPE_FUNCTIONS[fcnName] ) throw new Error( `No scope defined for "${fcnName}"` );
    });
    if ( fcnNames.length === 1 ) {
      let fcnName = fcnNames[0];
      return {
        ...p,
        scope: (o, rule) => {
          return SCOPE_FUNCTIONS[fcnName](user, o, rule);
        }
      };
    } else {
      let scopes = fcnNames.map((fcnName) => {
        return function(o, rule) {
          return SCOPE_FUNCTIONS[fcnName](user, o, rule);
        }
      });
      return {
        ...p,
        scope: scopes,
      };
    }
  });
  
  // build up the rules from the permissions
  return new Ability(permissions);
}

// ala express (req.user.ability)
const decorateUser = (user) => {
  user.ability = decorate(user);
}

// ala React (user = Ability.decorateUserImmutable(this.props.user))
const decorateUserImmutable = (user) => {
  let iuser = _cloneDeep(user);
  iuser.ability = decorate(user);
  return iuser;
}

module.exports = {
  decorateUser,
  decorateUserImmutable,
};

