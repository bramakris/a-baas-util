# a-baas-util 

API/SDK for working with Apigee BaaS. _Promises_ a easy interface to work with (Pun!)

## Install

```bash
  npm install a-baas-util
``` 

## Usage

```javascript
  var _ = require("a-baas-util")(opts)
```
See Initialization options below for required keys in `opts`

## Initialization Options

| key      | mandatory | description                                           | default |
|----------|-----------|-------------------------------------------------------|---------|
| host     | no        | The hostname to connect to                            | derived |
| key      | yes       | Client key to use for connection                      |         |
| secret   | yes       | Client secret to use for connection                   |         |
| org      | yes       | BaaS organization                                     |         |
| app      | yes       | BaaS application - normally maps to a environment     |         |
| throttle | no        | Throttling specified in rpm (requests/minute)         | 120     |
| limit    | no        | No of records to pick for query before cursor is used | 1000    |

The **host** needs to be specified only for trial apigee accounts/on-premise accounts, otherwise it is normally derived as **baas-${org}.apigee.net**

The **limit** parameter has a cap at **1000**. If more is specified, it will still default to 1000. If limit is 1000 and your collection has 1500 entities, 2 API calls will be made internally to retrieve all data

The **throttle** parameter is specified in requests per minute (rpm) and the requests are evenly spread out during the period

It is recommended to load your options from the environment, rather than hard-coding it in your program

```javascript
  var env = process.env
  var opts = {
    host    : env.BAAS_HOST,
    org     : env.BAAS_ORG,
    app     : env.BAAS_APP,
    key     : env.BAAS_KEY,
    secret  : env.BAAS_SECRET
  }
  var _ = require('a-baas-util')(opts)
  
  // More interesting code here 
```

## API
The API is mostly promise based to encourage better programmer practices. There are callback based counterparts for some API's where data size can be huge.

Note: Majority of the API's are promise based. So the return value depicted is only got after resolving the promise

### _.get
```javascript
  _.get(collection, query) => [entity1, entity2, ...]
  _.get(collection) => [entity1, entity2, ... , last-record]
``` 
`query` can be string or object. 

Internally objects will be converted to strings using the **AND** logical operation. For OR operations, use the string format

```javascript
  {name: "john", lastname: "doe"} => "name='john' and lastname='doe'"
```

Do not use this API for large collections. Use the `_.query` method for that purpose.

### _.get1

```javascript
  _.get1(collection, query) => object | null
```

Similar to `_.get`, but performs a query with **limit = 1** and returns only one object or null, if object is not found.

### _.getFile

```javascript
  _.getFile(collection, query) => stream
```
Returns a promise when resolved results in a stream which can be piped to a write stream.

Use this to save attachments tagged with a entity

### _.getAndSave

```javascript
  _.getAndSave(collection, query, file, folder) => data
```  
Helper to perform query on the given collection and save the output to the designated file in the designated folder. 

Handles saving attachments as required if `file-metadata` property is found in each entity's body

Use this API to save a collection of entities and the attachments they are linked with in one-go

### _.query

```javascript
  _.query(collection, query, cb)
``` 

Not Promise based. Callback based interface. 

To handle large data, use this method rather than the promises based `_.get` API, which loads the entire dataset

### _.token

```javascript
  _.token() => token
```

Returns a BaaS token. Internally caches the token based on the expiry before returning it. 

Use this method if you are constructing your own HTTP requests to call management API's not exposed by this SDK. Recommended to use this in conjunction with `_.request`

### _.collections

```javascript
  _.collections(which) => [name1, name2, ...]
```  
If which = *, gets all collection names. 

If which is any string not *, considers that as a comma separated list of collection names and returns the same

```javascript
  _.collections("*")            => [name1, name2, name3]
  _.collections("roles, users") => ["roles", "users"]
```

### _.put

```javascript
  _.put(collection, data) => [entity1, entity2, ...]
``` 
`data` can either be a object or array of objects. The SDK will transparently handle both.

The `uuid` or `name` field is used as the key to update the record, which-ever is present. If both are present, `uuid` is preferred. 

If you have a non-standard field as a key (you really shouldn't), then use the `putBy` method

### _.putBy

```javascript
  _.putBy(collection, data, property) => [entity1, entity2, ...]
``` 
**WARNING** - This method will enforce that the passed-in records are put into the database based on the property identifier

Supports non standard fields as a unique identifier. If your uniqueness is identified by the `name` attribute, use `_.put` instead rather than this API

`property` can either be a string containing the property used for uniqueness or it can be a array of strings to serve as a composite key.

This method first issues a `GET` based on the properties listed and if it does not find the record, it `POST`s to the collection, effectively creating the object. 

If it finds the record, it issues a regular `PUT` based on the `uuid`

Use this method only if you are sure that the result of the operation has to end up with a record in the database

### _.post

```javascript
  _.post(collection, data) => [entity1, entity2, ...]
``` 
`data` can be object or array

### _.delete

```javascript
  _.delete(collection, data) => [entity1, entity2, ...]
``` 
`data` can be object or array. 

Uses the `uuid` or `name` attribute as the identifying key to delete the entity

### _.deleteBy

```javascript
  _.deleteBy(collection, data, property) => [entity1, entity2, ...]
``` 
Delete counterpart of `putBy`, if you wish to delete by non standard fields
`property` can be a string or a array of strings. 

Internally issues a `GET` first to get the `uuid` of the record to delete and then issues a `DELETE` HTTP request

### _.read

```javascript
  _.read(file, encoding) => string-content | object
``` 
`encoding` parameter is optional. If left out, reads in **utf-8** encoding by default

If the `file` parameter ends with `.json`, automatically parses the file content's as well before returning it

### _.write

```javascript
  _.write(file, data, encoding) => data
``` 
`encoding` is optional. If left out, uses **utf-8** by default

Returns back the data again to support easy promise chaining 

### _.readstream

```javascript
  _.readstream(file, enc) => stream
```  
Not promise based. Returns stream from the `fs` module

### _.writeStream

```javascript
  _.writestream(file, enc)
```  
Not promise based. Returns write stream from the `fs` module

### _.mkdirp

```javascript
  _.mkdirp('path1/path2/sub-path/p3')
  _.mkdirp('path1/path2', opts)
```
Not promise based. Exposes the synchronous method of [`mkdirp`](https://www.npmjs.com/packages/mkdirp) library as default.

### _.request

```javascript
  _.request
``` 
Exposes the promise variant of the [`request`](https://www.npmjs.com/package/request) library.

For the native `request` library (non promise based), use `_.nrequest`

## Samples

Get a collection and save it into a file

```javascript
  _.get("roles")
  .then(roles => _.write("roles.json", roles))
```  

Get a collection, transform it and update it back in the database

```javascript
  _.get("roles")
  .then(r => r.map(roleTransformer))
  .then(r => _.put("roles", r))
```  

Given a list of ID's, get all entities of a certain collection by those ID's

```javascript
  Promise.resolve(['id1', 'id2', 'id33'])
  .then(ids => Promise.all(ids.map(id => {
    return _.get1("roles", {name: id}) // This returns a single promise
  })))
  // An array of promises is returned to Promise.all which returns one master promise
  // which when resolved, will contain all the data from all the requests made
```

