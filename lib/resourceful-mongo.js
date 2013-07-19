var url = require('url'),
    resourceful = require('resourceful'),
    mongo = require('mongodb'),
    async = require('async');

exports.connections = {};
exports.deferred = {};

var Mongo = exports.Mongo = function Mongo(config) {
  var self = this;

  // This function is being called to specify a database connection, define a model, or both. If
  // neither a collection name nor an onConnect callback is given, throw an error.
  if ((!config.collection || typeof config.collection !== 'string') && typeof config.onConnect !== 'function') {
      throw new Error("A collection string or onConnect callback must be specified in the config parameter.");
  }

  if (config.uri) {
    var uri = url.parse(config.uri, true);
    config.host = uri.hostname;
    config.port = uri.port;

    if (uri.pathname) {
      config.database = uri.pathname.replace(/^\/|\/$/g, '');
    }

    if (uri.query) {
      resourceful.mixin(config, uri.query);
    }
  }

  config.host     = config.host     || '127.0.0.1';
  config.port     = config.port     || 27017;
  config.database = config.database || resourceful.env || 'test';

  config.uri = url.format({
    protocol: 'mongodb',
    hostname: config.host,
    port: config.port,
    pathname: '/'+config.database
  });

  config.port = parseInt(config.port, 10);

  this.config = config;
  this.cache = new resourceful.Cache();

  // If a connection for this URI has already been made, use it.
  if (exports.connections[config.uri]) {
    this.connection = exports.connections[config.uri];

  // Otherwise if an onConnect callback was given, open a new connection.
  } else {
  //if (typeof config.onConnect === 'function') {
    onConnectHook = typeof config.onConnect === 'function';
    new mongo.Db(config.database, new mongo.Server(config.host, config.port, {})).open(function(err, db) {
      if (onConnectHook && err) {
        return config.onConnect(err);
      }

      self.connection = exports.connections[config.uri] = db;

      (function handleDeferredAction(i) {
        if (exports.deferred[config.uri] && i<exports.deferred[config.uri].length) {
          exports.deferred[config.uri][i](config.uri, function() {
              handleDeferredAction(++i);
          });
        } else {
          delete exports.deferred[config.uri];
          if (onConnectHook) {
            config.onConnect();
          }
        }
      })(0);
    });

  // Failing that, just remember to set `this.connection` when the appropriate connection does get made.
  // This makes it easy to define resources before opening their database connection.
  }/* else {
    if (!exports.deferred[config.uri]) {
      exports.deferred[config.uri] = [];
    }

    exports.deferred[config.uri].push(function(uri, callback) {
      self.connection = exports.connections[uri];
      callback();
    });
  }*/
};

Mongo.prototype.protocol = 'mongodb';

// Lazy-load the resource's collection
Mongo.prototype.collection = function(callback) {
  var self = this;

  if (this._collection) {
    return callback(null, this._collection);
  } else {
    this.connection.collection(self.config.collection, function(err, collection) {
      if(err) return callback(err);
      self._collection = collection;
      return callback(null, collection);
    });
  }
};

Mongo.prototype.save = function (id, doc, callback) {
  var args = Array.prototype.slice.call(arguments, 0);
  var callback = args.pop();
  var doc = args.pop();

  doc._id = args.length ? id : doc.id;
  delete doc['id'];

  var config = this.config;

  this.collection(function(err, collection) {
    if(err) return callback(err);
    console.log(doc)
    collection.save(doc, function(err, doc) {
      if (err) return callback(err);

      console.log(doc)
      doc.id = doc._id;
      delete doc['_id'];

      callback(null, doc);
    });
  });
};

Mongo.prototype.update = function (id, doc, callback) {
  var self = this;

  this.collection(function(err, collection){
    if(err) return callback(err);

    collection.update({'_id': id}, {$set: doc}, function(err) {
      if(err) return callback(err);

      return self.get(id, callback);
    });
  });
};

Mongo.prototype.get = function(id, callback) {
  this.collection(function(err, collection) {
    if(err) return callback(err);

    collection.findOne({'_id': id}, function(err, doc) {
      if(err) return callback(err);

      if (doc) {
        doc.id = doc._id;
        delete doc['_id'];
      }

      callback(null, doc || {});
    });
  });
};

Mongo.prototype.find = function(criteria, callback) {
  this.collection(function(err, collection) {
    collection.find(criteria).toArray(function (err, docs) {
      if(err) return callback(err);

      async.each(docs, function (doc, next) {
        doc.id = doc._id;
        delete doc['_id'];
        next();
      }, function(err) {
        callback(err, docs);
      });
    });
  });
};

Mongo.prototype.destroy = function(id, callback) {

  var config = this.config;

  this.collection(function(err, collection) {
    collection.remove({'_id': id}, callback);
  });
};

//register engine with resourceful
resourceful.engines.Mongodb = Mongo;

//export resourceful
module.exports = resourceful
