# Abilities

This is a client-side library for managing user permissions in the Smart Monitor environment.

You will get the user somehow, ultimately from the Smart Monitor user management system.  This
user will include an array of roles, each with an array of permissions.  The user will also
have an entity and that entity might have entities (a tree).

When you need to determine if the user can do things, you must "decorate" the user with this library:

```js
const Abilities = require( 'ability' );
Abilities.decorateUser(user);
```

Now you can do things like:

```js
if ( user.ability.can( 'update', [patientData, 'Patient'] ) ) {
  ...
}
```

This library rests on top of a version of [casl](https://stalniy.github.io/casl/abilities/2017/07/21/check-abilities.html).

## Checks

```js
  user.can( ACTION, SUBJECT )
  user.cannot( ACTION, SUBJECT )
```

Built in `ACTION`s are "create", "read", "update" and "delete", but other custom actions might be defined.  "crud" is
an alias for any of the four just mentioned.  "manage" is an alias for any action (*).  

The `SUBJECT` is what the user is trying to act upon.  It can be a string, a class instance, or an array of [object, 'ClassName'].
In the Smart Monitor case, it will probably almost always be [object, 'ClassName'] since we're most often dealing with non-class
objects.  Our class names include but are not limitted to: 'User', 'Entity', 'Patient'.

## React

If you are using this in a React app, then you'll probably want to use `connect` to add the user in the redux store to
a components props, and then in render() do the decoration.  Maybe something like this:

```js
import Ability from 'ability';

class MyComponent extends React.Component {
  ...
  render() {
    const user = Ability.decorateUserImmutable(this.props.user);
    return(
      ...
      {user.ability.can('edit', [patient, 'Patient']) ? <Edit patient={patient} /> : null }
      ...
    );
  }
}
export connect(store => {
  return {
    user: store.user
  };
}, null)(MyComponent);

```

## Express

In express, you'll probably want to decorate the user in middleware, after the user has been authenticated.  Something
like:

```js
app.use(function(req, res, cb) {
  if ( req.user ) Ability.decorateUser(req.user);
  cb();
});
```

# Scope Functions

The so-called "scope functions" are defined in this library and must match those names defined and used in the 
Smart Monitor user management system.

