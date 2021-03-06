/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert-plus');
var once = require('once');

var Queue = require('./queue').Queue;



///--- Globals

var DATACENTER = process.env.MANTA_DATACENTER;
if (!DATACENTER) {
    console.error('you must set MANTA_DATACENTER in the environment');
    console.error('export MANTA_DATACENTER=$(mdata-get "sdc:datacenter_name")');
    process.exit(1);
}



///--- Helpers

function build_index(opts, cb) {
    assert.object(opts, 'options');
    assert.object(opts.instances, 'options.instances');
    assert.object(opts.vmapi, 'options.vmapi');
    assert.func(cb, 'callback');

    cb = once(cb);

    var obj = {
        roles: {},
        servers: {},
        zones: {}
    };
    var q = new Queue({
        limit: 10,
        worker: function (inst, _cb) {
            function _done() {
                if (!obj.servers[inst.cn])
                    obj.servers[inst.cn] = [];

                obj.servers[inst.cn].push(inst);
                _cb();
            }

            if (inst.cn) {
                _done();
                return;
            }

            vmapi.getVm(inst, function (err, vm) {
                if (err) {
                    _cb(err);
                    return;
                }

                inst.cn = vm.server_uuid;
                _done();
            });
        }
    });
    var vmapi = opts.vmapi;

    Object.keys(opts.instances).forEach(function (k) {
        opts.instances[k].forEach(function (i) {
            if (!i.params || !i.params.tags || !i.params.tags.manta_role)
                return;

            // So. Gross. But SAPI has all kinds of garbage data
            /* JSSTYLED */
            var dc = /^http:\/\/\w+\.([a-z0-9-]+)\..*/.exec(i.metadata.SAPI_URL);
            if (!dc || dc.length < 2 || dc[1] !== DATACENTER)
                return;

            var role = i.params.tags.manta_role;
            var inst = {
                cn: i.params.server_uuid,
                role: role,
                uuid: i.uuid
            };

            if (!obj.roles[role])
                obj.roles[role] = [];
            if (!obj.zones[i.uuid])
                obj.zones[i.uuid] = [];


            obj.roles[role].push(inst);
            obj.zones[i.uuid].push(inst);

            q.push(inst);
        });
    });

    q.once('error', cb);
    q.once('end', function () {
        cb(null, obj);
    });
    q.close();
}



///--- API

function get_application(opts, cb) {
    assert.object(opts, 'options');
    assert.object(opts.application, 'options.application');
    assert.object(opts.sapi, 'options.sapi');
    assert.optionalString(opts.application.name, 'options.application.name');
    assert.func(cb, 'callback');

    cb = once(cb);

    var params = {
        name: opts.application.name || 'manta',
        include_master: true
    };
    opts.sapi.listApplications(params, function (err, apps) {
        if (err) {
            cb(err);
            return;
        }

        if ((apps || []).length < 1) {
            cb(new Error('SAPI found no application ' + opts.application.name));
            return;
        }

        opts.application.uuid = apps[0].uuid;
        cb();
    });
}


function get_instances(opts, cb) {
    assert.object(opts, 'options');
    assert.object(opts.application, 'options.application');
    assert.object(opts.sapi, 'options.sapi');
    assert.optionalString(opts.application.name, 'options.application.name');
    assert.func(cb, 'callback');

    cb = once(cb);

    var params = {
        include_master: true
    };
    var uuid = opts.application.uuid;

    opts.sapi.getApplicationObjects(uuid, params, function (err, svcs) {
        if (err) {
            cb(err);
            return;
        }

        opts.instances = svcs.instances;
        build_index(opts, function (err2, instances) {
            if (err2) {
                cb(err2);
                return;
            }

            var keys = Object.keys(instances);
            keys.sort();
            keys.forEach(function (k) {
                opts.application[k] = instances[k];
            });

            cb();
        });
    });
}


function load_application(opts, cb) {
    assert.object(opts, 'options');
    assert.object(opts.application, 'options.application');
    assert.object(opts.log, 'options.log');
    assert.object(opts.sapi, 'options.sapi');
    assert.optionalString(opts.application.name, 'options.application.name');
    assert.func(cb, 'callback');

    cb = once(cb);

    get_application(opts, function (err) {
        if (err) {
            cb(err);
            return;
        }

        get_instances(opts, function (err2) {
            if (err2) {
                cb(err2);
                return;
            }

            cb(null, opts.application);
        });
    });
}



///--- Exports

module.exports = {
    get_application: get_application,
    get_instances: get_instances,
    load_application: load_application
};
