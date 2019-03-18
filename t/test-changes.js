const ability = require( '../index' );
require( 'console.table' );

/* NOTES

   Patients are somewhat special.  They can belong to multiple entities and have multiple
   caregivers, but both entities and caregivers (users) are not in the same database
   as patients.  Do I think a patient will have something like this:

   { caregiverId: "primaryCaregiverId", cargiverIds: [other caregiver ids], entitiyIds: [entity ids] }

   which will be inflated and deflated by loopback.  Perhaps there are custom methods
   on the Shimpatient/Patient model that can fetch this stuff from the UMS and hang it off 
   of "caregivers" and "entities".  But the permissions should refer only to the arrays
   present in the patient instance.

   Patients can belong to multiple entites and can have multiple caregivers.  But when
   a nurse creates a patient, they are initially assigning one entity and one caregiver.
   For the "create" check to work, a patient structure must be passed with "entityId" and
   "caregiverId" set to something, even though that is not how the database model will
   be created; something like this:

   let patientData = {
     ...req,body,
     caregiverId: req.user.id,
     entityId: req.user.entity.id
   };
   if ( req.user.ability.can( 'create', [ patientData, 'Patient' ] ) ) ...

   Then go ahead and create the database stuff if the check passes.


   Creating an entity or a user will require the client to add "entityId" as a
   property to the object (user or entity) being checked, which is the intended
   entity to which the object will be added.  After the check, this can be thrown away
   and the real database relations established.

 */

let ROLES = {
  Nurse: {
    name: "nurse",
    description: [
      "Can see any patient in user's entity.",
      "Can create a patient in their own entity that they will manage.",
      "Can only update patients if they are a caregiver.",
    ],
    permissions: [
      { actions: 'read', subject: 'Patient', scope: 'BELONGS_TO_SUB_ENTITIES' },
      { actions: 'create', subject: 'Patient', scope: ['IS_PRIMARY_CAREGIVER', 'BELONGS_TO_SUB_ENTITIES'] },
      { actions: 'update', subject: 'Patient', scope: 'IS_CAREGIVER' },
    ]
  },
  Manager: {
    name: "manager",
    permissions: [
      { actions: 'read', subject: 'Patient', scope: 'BELONGS_TO_SUB_ENTITIES' },
      { actions: 'addBulk', subject: 'Patient', scope: 'BELONGS_TO_SUB_ENTITIES' },
    ]
  },
  EntityAdmin: {
    name: "entityAdmin",
    description: [
      "Can create sub entities for this entity (but no further).",
      "Can manage users in this entity and direct sub-entities.",
    ],
    permissions: [
      { actions: 'manage', subject: 'User', scope: 'BELONGS_TO_SUB_ENTITIES' },
      { actions: 'manage', subject: 'Entity', scope: 'BELONGS_TO_SUB_ENTITIES' },
    ]
  },
  EntityUserAdmin: {
    name: "entitySubAdmin",
    description: [
      "Can only manage users in the entity this user belongs to.",
    ],
    permissions: [
      { actions: 'manage', subject: 'User', scope: 'BELONGS_TO_ENTITY' },
    ]
  },
  SuperAdmin: {
    name: "superAdmin",
    permissions: [
      { actions: 'manage', subject: 'all' },
    ]
  }
};

// Hierarchy of entities
//
let HTA1 = { id: 'hta1', name: 'HTA1', entities: [] };
let HTA2 = { id: 'hta2', name: 'HTA2', entities: [] };
let SE1 = { id: 'se1', name: 'SE1', entities: [] };
let SE2 = { id: 'se2', name: 'SE2', entities: [] };
let CVS  = { id: 'cvs', name: 'CVS', entities: [ HTA1, HTA2 ] };
let CVSPilot  = { id: 'cvsp', name: 'CVS Pilot', entities: [ SE1, SE2 ] };
let SmartMonitor = { id: 'sm', name: 'Smart Monitor', entities: [ CVS, CVSPilot ] };

// Users
let _id = 1;
const uid = () => {
  return `uid${_id++}`;
}

let Nurses = {};
[ CVS, CVSPilot, HTA1, HTA2, SE1, SE2 ].forEach((entity) => {
  Nurses[entity.name] = {
    id: uid(),
    entity,
    roles: [ ROLES.Nurse ]
  };
  ability.decorateUser(Nurses[entity.name]);
});

let managerForCVS = {
  id: uid(),
  entity: CVS,
  roles: [ ROLES.Manager ]
};

let superAdmin = {
  id: uid(),
  entity: SmartMonitor,
  roles: [ ROLES.SuperAdmin ]
};

let userAdminForHTA1 = {
  id: uid(),
  entity: HTA1,
  roles: [ ROLES.EntityUserAdmin ]
};

let entityAdminForSM = {
  id: uid(),
  entity: SmartMonitor,
  roles: [ ROLES.EntityAdmin ]
};

let patientHTA1 = {
  id: 'pid1',
  caregiverId: Nurses['HTA1'].id,
  entityIds: [
    HTA1
  ].map(e => e.id )
};

let patientHTA1HTA2 = {
  id: 'pid2',
  caregiverId: Nurses['HTA2'].id,
  entityIds: [
    HTA1, HTA2
  ].map(e => e.id )
};

let patientSE1 = {
  id: 'pid3',
  caregiverId: Nurses['SE1'].id,
  entityIds: [
    SE1
  ].map(e => e.id )
};

ability.decorateUser(managerForCVS);
ability.decorateUser(superAdmin);
ability.decorateUser(userAdminForHTA1);
ability.decorateUser(entityAdminForSM);

//---------------------------------

const atest = ( user, action, subject, subjectName, expect ) => {
  let data = {
    userId: user.id,
    roles: user.roles.map((r) => {return r.name;}).join(', '),
    action,
    subjectId: subject.id,
    subjectName,
    expect,
  };
  data.res = user.ability.can( action, [subject, subjectName]);
  data.status = ( data.res === data.expect ? 'PASS' : 'FAIL' );
  //console.log( `user can ${action} ${subjectName}: ${res}: ${res === expect ? 'PASS' : 'FAIL'}` );
  return data;
}

//--------------------------------

let tests = [];

// a nurse can manage their own patient
// a nurse can create a new patient in their own entity
// a nurse cannot create a patient in another entity
// a nurse cannot create a patient with a different caregiver

tests.push( atest( Nurses['HTA1'], 'read', patientHTA1, 'Patient', true ) );
tests.push( atest( Nurses['HTA1'], 'read', patientHTA1HTA2, 'Patient', true ) );
tests.push( atest( Nurses['HTA1'], 'read', patientSE1, 'Patient', false ) );
tests.push( atest( Nurses['HTA1'], 'update', patientHTA1, 'Patient', true ) );
tests.push( atest( Nurses['HTA1'], 'update', patientHTA1HTA2, 'Patient', false ) );
tests.push( atest( Nurses['HTA1'], 'update', patientSE1, 'Patient', false ) );

tests.push( atest( Nurses['HTA1'], 'create', {caregiverId: Nurses['HTA1'].id, entityId: Nurses['HTA1'].entity.id}, 'Patient', true ) );
tests.push( atest( Nurses['HTA1'], 'create', {caregiverId: Nurses['HTA1'].id, entityId: 'xxx'}, 'Patient', false ) );
tests.push( atest( Nurses['HTA1'], 'create', {caregiverId: 'xxx', entityId: Nurses['HTA1'].entity.id}, 'Patient', false ) );

// a manager can see patients in their own entity and one level down
// a manager cannot see patients up a level
// a manager cannot see patients down two or more levels

tests.push( atest( managerForCVS, 'read', patientHTA1, 'Patient', true ) );
tests.push( atest( managerForCVS, 'read', patientHTA1HTA2, 'Patient', true ) );
tests.push( atest( managerForCVS, 'read', patientSE1, 'Patient', false ) );
tests.push( atest( managerForCVS, 'update', patientHTA1, 'Patient', false ) );
tests.push( atest( managerForCVS, 'update', patientHTA1HTA2, 'Patient', false ) );
tests.push( atest( managerForCVS, 'update', patientSE1, 'Patient', false ) );

// a superadmin can do anything, anywhere

tests.push( atest( superAdmin, 'read', patientHTA1, 'Patient', true ) );
tests.push( atest( superAdmin, 'read', patientHTA1HTA2, 'Patient', true ) );
tests.push( atest( superAdmin, 'read', patientSE1, 'Patient', true ) );
tests.push( atest( superAdmin, 'update', patientHTA1, 'Patient', true ) );
tests.push( atest( superAdmin, 'update', patientHTA1HTA2, 'Patient', true ) );
tests.push( atest( superAdmin, 'update', patientSE1, 'Patient', true ) );

// a entity user admin can manage users belonging to the same entity
// a entity user admin cannot manage users outside of their own entity
// a entity user admin cannot manage entities

tests.push( atest( userAdminForHTA1, 'update', Nurses['HTA1'], 'User', true ) );
tests.push( atest( userAdminForHTA1, 'create', {entityId: userAdminForHTA1.entity.id}, 'User', true ) );
tests.push( atest( userAdminForHTA1, 'create', {entityId: 'XXX'}, 'User', false ) );

// an entity admin can manage users and entities at their own level and one down

// edit my entity
tests.push( atest( entityAdminForSM, 'update', SmartMonitor, 'Entity', true ));
// edit entity one level down
tests.push( atest( entityAdminForSM, 'update', CVS, 'Entity', true ));

// try a second level down
tests.push( atest( entityAdminForSM, 'update', HTA1, 'Entity', false ));

// edit a user in my entity
tests.push( atest( entityAdminForSM, 'update', superAdmin, 'User', true ));
// edit a user in an entity one level down
tests.push( atest( entityAdminForSM, 'update', Nurses['CVS'], 'User', true ));
// try a second level down
tests.push( atest( entityAdminForSM, 'update', Nurses['HTA1'], 'User', false ));

// edit a user in my entity
tests.push( atest( entityAdminForSM, 'create', {entityId: entityAdminForSM.entity.id}, 'User', true ));
// edit a user in an entity one level down
tests.push( atest( entityAdminForSM, 'create', {entityId: Nurses['CVS'].entity.id}, 'User', true ));
// try a second level down
tests.push( atest( entityAdminForSM, 'create', {entityId: Nurses['HTA1'].entity.id}, 'User', false ));


let failed = 0;
tests.forEach((t) => {
  if ( t.status === 'FAIL' ) failed += 1;
});

console.table( tests );

if ( failed ) {
  console.log( `FAILED: ${failed}` );
}



