var helpers = require(__dirname + '/helpers.js')
var request = require('request')
var config = (process.env.DATABASE_URL) ? process.env.DATABASE_URL : require(__dirname + '/config').db;
var dbRemote = require("seraph")({
    user: process.env.DATABASE_USER || config.username,
    pass: process.env.DATABASE_PASS || config.password,
    server: process.env.DATABASE_URL || config.dbURL
});
var ASQ = require('asynquence');
var q = require('q');
var urlToJobSystem = process.env.joburl||config.joburl

var relationshipInsert = module.exports.relationshipInsert = function(collection, moduleName, cb) {
    // var collection =
    // var moduleName = 
    function doInsert(relationshipName) {
        var querry = "MERGE (n:MODULE { name : '" + relationshipName + "'  }) MERGE(m:MODULE { name: '" + moduleName + "' }) MERGE (n)-[:DEPENDS_ON]->(m)"
        return function() {
            return ASQ().then(function(done) {
                dbRemote.queryRaw(querry,
                    function(err, result) {
                        if (err) {
                            done.fail(err);
                        } else {
                            done();
                        }
                    })
            })
        }
    }

    var doBatch = function() {
        if (collection.length === 0) {
            console.log("We are done.")
            cb();
        } else {
            //grab the first five in the list
            var batch = collection.slice(0, 12)
                //remove the first five from the list
            collection = collection.slice(12)
                //turn every item in the array into a function producing promise
            batch = batch.map(doInsert)
            console.log(Math.ceil(collection.length / 12), " Batches needing to get done")
            ASQ().gate.apply(null,
                    //Insert all five promise producing functions, into our gate call
                    batch.map(function(item) {
                        //return a promise
                        return item();
                    })
                ).val(function() {
                    console.log("HERE WE GO AGAIN!")
                    doBatch();
                })
                .or(function(err) {
                    console.log(err); // ReferenceError: foo is not defined
                });
        }

    }
    doBatch();
}

var dbInsert = module.exports.dbInsert = function(data) {
    var querryString = "MERGE (n:MODULE{name:{name}}) ON CREATE SET n.description = {description}, n.time = {time}, n.url = {url} , n.starred = {starred}, n.downloads = {downloads}, n.monthlyDownloadSum = {monthlyDownloadSum}, n.dependentsSize = {dependentsSize}, n.readme = {readme}, n.keywords = {keywords}, n.subscribers = {subscribers}, n.forks = {forks}, n.watchers = {watchers}, n.openIssues = {openIssues} ON MATCH SET n.description = {description}, n.time = {time}, n.url = {url} , n.starred = {starred}, n.downloads = {downloads}, n.monthlyDownloadSum = {monthlyDownloadSum}, n.dependentsSize = {dependentsSize}, n.readme = {readme}, n.keywords = {keywords}, n.subscribers = {subscribers}, n.forks = {forks}, n.watchers = {watchers}, n.openIssues = {openIssues} RETURN n";
    console.log("Working on inserting", data.name, " into database.")
    dbRemote.constraints.uniqueness.createIfNone('MODULE', 'name', function(err, constraint) {
        dbRemote.queryRaw(querryString, {
                name: data.name,
                description: data.description,
                time: JSON.stringify(data.time),
                url: data.url,
                starred: data.starred.length,
                downloads: JSON.stringify(data.downloads),
                monthlyDownloadSum: data.monthlyDownloadSum,
                dependentsSize: data.dependents.length,
                readme: data.readme,
                keywords: data.keywords,
                subscribers: data.subscribers,
                forks: data.forks,
                watchers: data.watchers,
                openIssues: data.openIssues
            },
            function(err, node) {
                if (err) {
                    console.log(err)
                } else {
                    console.log("INSERTION SUCCESS")
                    console.log("Done inserting nodes, now working on relationships.")
                    keyInsert(data, function(data) {
                        relationshipInsert(data.dependents, data.name, function() {
                            console.log("Finished inserting relationships into DB, sending response to Job Server")
                            request.post({
                                url: urlToJobSystem,
                                method: 'POST',
                                body: {
                                    module: data.name
                                },
                                json: true
                            }, function(err, resp, body) {
                                if (!err && resp.statusCode === 200) {
                                    console.log("We Are Done")
                                } else if (!err && resp.statusCode === 201) {
                                    console.log("New Module to Work On")
                                    helpers.moduleDataBuilder(body.module, function(err, data) {
                                        dbInsert(data)
                                    })
                                } else if (err) {
                                    console.log("Error on the Job Server Response \n", err)
                                }
                            })
                        })
                    })
                }
            })
    })
}

var keyInsert = module.exports.keyInsert = function(dataObj, cb) {
    var keyArr = dataObj.keywords
    var moduleName = dataObj.name
    var keysWithKeys = []
    var keyWithMod = []

    for (var x = 0; x < keyArr.length - 1; x++) {
        for (var y = x + 1; y < keyArr.length; y++) {
            keysWithKeys.push([keyArr[x], keyArr[y]])
        }
    }

    keyArr.forEach(function(item) {
        keyWithMod.push([moduleName, item])
    })


    //Inserts relationship between module, and keywords.

    function doInsertModKey(tuple) {

        return function() {
            var querry = "MERGE (m:MODULE{ name: '" + tuple[0] + "' }) MERGE (n:KEYWORD{name:'" + tuple[1] + "'}) MERGE (n)-[:KEYWORD_OF]->(m)"
            console.log(querry)
            return ASQ().then(function(done) {
                // console.log(moduleName)
                // console.log(key)
                dbRemote.queryRaw(querry,
                    function(err, result) {
                        if (err) {
                            done.fail(err);
                        } else {
                            console.log("Done inserting module relationship with keyword")
                            console.log(result)
                            done();
                        }
                    })
            })
        }
    }

    function doInsertKeyKey(tuple) {

        return function() {
            var querry = "MERGE (x:KEYWORD {name:'" + tuple[0] + "'}) MERGE (y:KEYWORD{name:'" + tuple[1] + "'}) MERGE (x)-[z:KEYWORD_RELATED_WITH]-(y) ON CREATE SET z.count = 1 ON MATCH SET z.count = z.count + 1 RETURN x,y,z;"
            return ASQ().then(function(done) {
                // console.log(moduleName)
                // console.log(key)
                dbRemote.queryRaw(querry,
                    function(err, result) {
                        if (err) {
                            done.fail(err);
                        } else {
                            console.log("Done inserting keyword relationship with keyword")
                            done();
                        }
                    })
            })
        }
    }
    keysWithKeys = keysWithKeys.map(doInsertKeyKey)
    keyWithMod = keyWithMod.map(doInsertModKey)
        // console.log(keysWithKeys)
        // console.log(keyWithMod)
    var promiseArray = keysWithKeys.concat(keyWithMod)
        // console.log(promiseArray.toString())
    var doBatch = function() {
        if (promiseArray.length === 0) {
            console.log("We are done.")
            cb(dataObj);
        } else {
            //grab the first five in the list
            var batch = promiseArray.slice(0, 1)
                //remove the first five from the list
            promiseArray = promiseArray.slice(1)
                //turn every item in the array into a function producing promise
            console.log(promiseArray.length, " Batches needing to get done")
            ASQ().gate.apply(null,
                    //Insert all five promise producing functions, into our gate call
                    batch.map(function(item) {
                        //return a promise
                        return item();
                    })
                ).val(function() {
                    console.log("HERE WE GO AGAIN!")
                    doBatch();
                })
                .or(function(err) {
                    console.log(err); // ReferenceError: foo is not defined
                });
        }

    }
    doBatch();
}
