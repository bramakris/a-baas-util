'use strict'

var nrequest    = require('request'),
    request     = require('request-promise-native'),
    fs          = require('fs'),
    path        = require('path'),
    mkdirp      = require('mkdirp'),
    Limit       = require('simple-rate-limiter')

/* Utility Belt for working with Apigee BaaS
 * This library promotes a Promise based API for most utilities, as they are
 * easier to write/read/review than their callback based counterparts */
var Util = function(opts) {

  var _         = {}, // similar convention as underscoreJS
      API       = {},
      Token     = null, // Map with {token, expiry}
      Throttle  = null

  var getToken = function() {
    if (Token && Token.expiry > new Date().getTime()) return Token.token
    // reset token
    Token = null
    return null
  }

  var setToken = function(token, expiry) {
    // We will pro-actively expire the token 1s before it really does
    var expiry = (new Date().getTime()) + (expiry - 1000)
    Token = {token: token, expiry: expiry} 
  }

  // All API methods return promises
  API.token = function() {
    return request({
      uri: `https://${opts.host}/${opts.org}/${opts.app}/token`,
      method: 'post',
      form: {
        grant_type: 'client_credentials',
        client_id: opts.key,
        client_secret: opts.secret
      },
      json: true
    })
  }

  // Attachments can be provided by using the special variable $file 
  // $file is a string path to the attachment -normally relative to the root directory
  var includeBody = function(args, data) {
    // Since entities can have only one attachment, 
    // we refer to the special variable $file to reference this attachment  
    // just a "file" property will not be considered as a attachment
    if (data['$file']) {
      args.formData = {}
      // form-data accepts only strings, buffers and streams
      Object.keys(data).map(k => {
        if (k !== "$file") {
          args.formData[k] = data[k]
          if (typeof args.formData[k] !== 'string')
            args.formData[k] = JSON.stringify(args.formData[k])
        }
        else args.formData[k.slice(1)] = fs.createReadStream(data[k]) 
      })
    } else {
      args.body = data
    }
    return args
  }

  //POST handles either object or Array of objects automatically
  API.postCollection = function(name, token, data) {
    var args = {
      uri: `https://${opts.host}/${opts.org}/${opts.app}/${name}?access_token=${token}`,
      json: true,
      method: 'post'
    }
    args = includeBody(args, data)
    return request(args)
  }

  //PUT supports only object, not arrays
  API.putCollection = function(name, token, data) {
    var key = data.uuid || data.name
    var args = {
      uri: `https://${opts.host}/${opts.org}/${opts.app}/${name}/${key}?access_token=${token}`,
      json: true,
      method: 'put'
    }
    args = includeBody(args, data)
    return request(args)
  }

  //Delete supports only single object - not array
  API.deleteCollection = function(name, token, data) {
    var key = data.uuid || data.name
    return request({
      uri: `https://${opts.host}/${opts.org}/${opts.app}/${name}/${key}?access_token=${token}`,
      json: true,
      method: 'delete'
    })
  }

  API.file = function(name, token, data) {
    var contentType = data['file-metadata'] ? data['file-metadata']['content-type'] : 'text/plain'
    var id = data.uuid || data.name
    // Return not the request with promises, but the native request (nrequest)
    // so that the response can be piped to streams
    return nrequest({
      uri: `https://${opts.host}/${opts.org}/${opts.app}/${name}/${id}?access_token=${token}`,
      headers: {
        'accept': contentType
      }
    })
  }

  API.collections = function(token) {
    return request({
      uri: `https://${opts.host}/${opts.org}/${opts.app}?access_token=${token}`,
      json: true
    })
  }

  API.query1 = function(collection, query, token) {
    var q = '&limit=1'
    if (query) q += '&ql=' + query
    return request({
      uri: `https://${opts.host}/${opts.org}/${opts.app}/${collection}?access_token=${token}${q}`,
      method: 'get',
      json: true
    })
  }

  API.query = function(collection, query, token, cursor) {
    var q = '&limit=' + (opts.limit || 1000)
    if (query) q += '&ql=' + query
    if (cursor) q += '&cursor=' + cursor
    return request({
      uri: `https://${opts.host}/${opts.org}/${opts.app}/${collection}?access_token=${token}${q}`,
      method: 'get',
      json: true
    })
  }

  _.token = function() {
    return new Promise((resolve, reject) => {
      var token = getToken()
      // Return cached non expired token if available
      if (token) return resolve(token)

      // Else get new token 
      API.token()
      .then(d => {
        if (d.error) return reject(d.error)
        // Cache token
        setToken(d.access_token, d.expires_in)
        resolve(d.access_token)
      })
      .catch(err => reject(err))
    })
  }

  _.collections = function(which) {
    return new Promise((resolve, reject) => {
      if (which === '*') {
        _.token()
        .then(token => API.collections(token))
        .then(d => {
          var coll = (d && d.entities.length) 
            ? Object.keys(d.entities[0].metadata.collections)
            : []
          return resolve(coll)
        })
      } else {
        which = (typeof which === 'string') ? which.split(',').map(c => c.trim()) : which
        return resolve(which)
      }
    })
  }

  // This is the only callback
  _.query = function(name, query, cb) {
    function getDataByCursor(cursor) {
      Throttle(function() {
        _.token()
        .then(token => {
          return API.query(name, query, token, cursor)
        })
        .then(data => {
          cb(data.error, data)
          if (data.cursor) getDataByCursor(data.cursor)
        })
        .catch(err => cb(err))
      })
    }
    getDataByCursor()
  }

  _.getFile = function(name, data) {
    return _.token()
    .then(token => API.file(name, token, data)) 
  }

  var buildQuery = function(query) {
    var q = query
    if (query && typeof query === 'object') {
      q = Object.keys(query).map(key => {
        var val = query[key]
        if (typeof val === 'string')
        val = "'" + val + "'"
        return key + "=" + val
      }).join(" and ")
    }
    return q
  }
  // promise based query
  // WARNING: Will load all data into RAM.
  // If you are dealing with large data, use the cb based `_.query` instead
  _.get = function(name, query) {
    var q = buildQuery(query)
    return new Promise((resolve, reject) => {
      var results = []
      var handler = function(cursor) {
        Throttle(function() {
          _.token()
          .then(token => API.query(name, q, token, cursor))
          .then(data => {
            results = results.concat(data.entities || [])
            if (! data.cursor) resolve(results)
            else handler(data.cursor) // continue until we get all data
          })
          .catch(err => reject(err))
        })
      }
      handler() // initially no cursor
    })
  }

  // get first record. normally used if query is of PK type
  // enforces limit=1 when performing the query in order to be faster
  _.get1 = function(name, query) {
    var q = buildQuery(query)
    return new Promise((resolve, reject) => {
      _.token()
      .then(token => API.query1(name, q, token))
      .then(data => resolve(data.entities.length ? data.entities[0] : null))
      .catch(err => reject(err))
    })
  }

  _.getAndSave = function(name, query, file, folder) {
    file = file || name + ".json"
    // create folder if it doesn't exist
    folder = folder || file.replace(/\..*$/, '') + '_data'
    return new Promise((resolve, reject) => {
      // do query
      _.get(name, query)
      .then(ad => {
        return new Promise((res, rej) => {
          var pending = ad.length

          var finish = function() {
            pending--
            if (! pending) res(ad)
          }
          if (! pending) return res(ad) // nothing to write save
          if (ad[0]['file-metadata']) mkdirp.sync(folder) // create folder if needed

          ad.map((entity, index) => {
            // If no file, do nothing
            if (! entity['file-metadata']) return finish()
            // fetch file and save as per our convention
            _.getFile(name, entity)
            .then(stream => {
              // Always use uuid because name might not be present
              ad[index]['$file'] = path.join(folder, entity.uuid + ".data")
              delete ad[index]['file-metadata']
              stream.pipe(_.writestream(ad[index]['$file']))
              .on('close', finish)
              .on('error', (err) => rej(err))
            })
          })
        })
      })
      .then(ad => _.write(file, ad))
      .then(ad => resolve(ad))
      .catch(err => reject(err))
    })
  }

  // TODO: Do not expose this
  _.do = function(method, name, data) {
    return new Promise((resolve, reject) => {
      if (! Array.isArray(data)) data = [data]
      var pending = data.length 
      var index = 0
      var results = []

      var handler = function(obj) {
        var meth = method === 'put' && !obj.name && !obj.uuid ? 'post' : method 
        _.token()
        .then(token => API[meth + 'Collection'](name, token, obj))
        .then(res => {
          results = results.concat(res.entities)
          pending--
          index++
          if (! pending) resolve(results)
          else handler(data[index])
        })
        .catch(err => reject(err))
      }
      if (pending) handler(data[index])
      else resolve([])
    })
  }

  // POST automatically handles multiple entities as arrays in one operations
  _.post = function(name, data) {
    return _.do('post', name, data)
  }

  // PUT does not support arrays. So we enable it manually
  _.put = function(name, data) {
    return _.do('put', name, data)
  }

  var doBy = function(op, name, data, prop) {
    if (! Array.isArray(data)) data = [data]
    if (! Array.isArray(prop)) prop = [prop]
    return new Promise((resolve, reject) => {

      var pending = data.length
      if (! pending) resolve([])

      data.map((row, index) => {
        var q = {}
        prop.map(function(p) {
          q[p] = row[p]
        })
        _.get(name, q)
        .then(d => {
          // Object does not exist
          // assign UUID
          if (d.length && d.length === 1) {
            data[index].uuid = d[0].uuid
          }
          pending--
          if (! pending) {
            // Do one BULK operation at the end
            _[op](name, data)
            .then(d => resolve(d))
            .catch(e => reject(e))
          }
        })
      })
    })
  }

  _.putBy = function(name, data, prop) {
    return doBy("put", name, data, prop)
  }

  _.delete = function(name, data) {
    return _.do('delete', name, data)
  }

  _.deleteBy = function(name, data, prop) {
    return doBy('delete', name, data, prop)
  }

  /* Generic utilities - also promise based */
  _.read = function(file, enc) {
    return new Promise(function(resolve, reject) {
      var identity = (x) => x
      try {
        var opts = enc ? {encoding: enc} : {encoding: "utf-8"}
        var parser = file.toLowerCase().endsWith(".json") ? JSON.parse : identity
        resolve(parser(fs.readFileSync(file, opts)))
      } catch (e) { 
        reject(e)
      }
    })
  }

  _.readstream = function(file, enc) {
    enc = enc || 'utf-8'
    return fs.createReadStream(file, {encoding: enc})
  }

  _.write = function(file, data, enc) {
    return new Promise(function(resolve, reject) {
      try {
        var str = file.toLowerCase().endsWith(".json") 
          ? JSON.stringify(data, null, 2) : data
        var opts = {}
        opts.encoding = enc ? enc : "utf-8"
        fs.writeFileSync(file, str, opts)
        resolve(data)
      } catch (e) {
        reject(e)
      }
    })
  }

  _.writestream = function(file, enc) {
    enc = enc || 'utf-8'
    return fs.createWriteStream(file, {encoding: enc})
  }

  _.mkdirp = function(dir, opts) {
    return mkdirp.sync(dir, opts)
  }

  // To make generic API requests
  _.request = request
  _.nrequest = nrequest

  var init = function() {
    if (! opts.throttle) opts.throttle = 120
    if (! opts.limit) opts.limit = 1000
    if (! opts.host) opts.host = 'baas-' + opts.org + '.apigee.net'
    if (opts.throttle)
      Throttle = Limit(cb => cb()).to(opts.throttle).per(60000).evenly(true)
  }
  init()

  return _
}

module.exports = Util
