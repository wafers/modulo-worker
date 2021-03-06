var helpers = require(__dirname + '/helpers.js')
var request = require('request')
var config = (process.env.DATABASE_URL) ? process.env.DATABASE_URL : require(__dirname + '/config').db;
var dbRemote = require("seraph")({
    user: process.env.DATABASE_USER || config.username,
    pass: process.env.DATABASE_PASS || config.password,
    server: process.env.DATABASE_URL || config.dbURL
});
var ASQ = require('asynquence');
var urlToJobSystem = process.env.joburl || config.joburl
var numberOfInsertions = process.env.numberOfInsertions || 8

var relationshipInsert = module.exports.relationshipInsert = function(collection, moduleName, cb) {
    // var collection =
    // var moduleName = 
    function doInsert(relationshipName) {
        console.log("Inserting module relationship for module ",moduleName , " with module ", relationshipName)
        var querry = "MERGE (n:MODULE { name : {relationshipModule}  }) MERGE(m:MODULE { name: {mainNode} }) MERGE (n)-[:DEPENDS_ON]->(m)"
        return function() {
            return ASQ().then(function(done) {
                dbRemote.queryRaw(querry, {
                    relationshipModule : relationshipName,
                    mainNode : moduleName
                },
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
            var batch = collection.slice(0, numberOfInsertions)
                //remove the first five from the list
            collection = collection.slice(numberOfInsertions)
                //turn every item in the array into a function producing promise
            batch = batch.map(doInsert)
            console.log(Math.ceil(collection.length / numberOfInsertions), " Batches needing to get done")
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
    var querryString = "MERGE (n:MODULE{name:{name}}) ON CREATE SET n.description = {description}, n.time = {time}, n.url = {url} , n.starred = {starred}, n.downloads = {downloads}, n.monthlyDownloadSum = {monthlyDownloadSum}, n.dependentsSize = {dependentsSize}, n.readme = {readme}, n.keywords = {keywords}, n.dateRank = {dateRank}, n.versionNumberRank = {versionNumberRank}, n.downloadRank = {downloadRank}, n.starRank = {starRank}, n.dependentRank = {dependentRank}, n.completenessRank = {completenessRank}, n.completenessFailures = {completenessFailures}, n.overallRank = {overallRank}ON MATCH SET n.description = {description}, n.time = {time}, n.url = {url} , n.starred = {starred}, n.downloads = {downloads}, n.monthlyDownloadSum = {monthlyDownloadSum}, n.dependentsSize = {dependentsSize}, n.readme = {readme}, n.keywords = {keywords}, n.dateRank = {dateRank}, n.versionNumberRank = {versionNumberRank}, n.downloadRank = {downloadRank}, n.starRank = {starRank}, n.dependentRank = {dependentRank}, n.completenessRank = {completenessRank}, n.completenessFailures = {completenessFailures}, n.overallRank = {overallRank} RETURN n";
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
                dependentsSize: data.dependentsSize,
                readme: data.readme,
                keywords: data.keywords,
                dateRank: data.dateRank,
                versionNumberRank: data.versionNumberRank,
                downloadRank: data.downloadRank,
                starRank: data.starRank,
                dependentRank: data.dependentRank,
                completenessRank: data.completenessRank,
                completenessFailures: data.completenessFailures,
                overallRank: data.overallRank,
                // subscribers: data.subscribers,
                // forks: data.forks,
                // watchers: data.watchers,
                // openIssues: data.openIssues
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
                                    requestForModule(body.module)
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
            console.log("Inserting Keyword relationship for module", tuple[0])
            var querry = "MERGE (m:MODULE{ name: {moduleName} }) MERGE (n:KEYWORD{name:{keywordName}}) MERGE (n)-[:KEYWORD_OF]->(m)"
            return ASQ().then(function(done) {
                // console.log(moduleName)
                // console.log(key)
                dbRemote.queryRaw(querry, {
                    moduleName: tuple[0],
                    keywordName : tuple[1]
                },
                    function(err, result) {
                        if (err) {
                            done.fail(err);
                        } else {
                            console.log("Done inserting module relationship with keyword")
                            done();
                        }
                    })
            })
        }
    }

    function doInsertKeyKey(tuple) {

        return function() {
            console.log("Inserting key relationship with key: ", tuple[0], "and key: ", tuple[1])
            var querry = "MERGE (x:KEYWORD {name:{keyword1}}) MERGE (y:KEYWORD{name:{keyword2}}) MERGE (x)-[z:KEYWORD_RELATED_WITH]-(y) ON CREATE SET z.count = 1 ON MATCH SET z.count = z.count + 1 RETURN x,y,z;"
            return ASQ().then(function(done) {
                dbRemote.queryRaw(querry, {
                    keyword1 : tuple[0],
                    keyword2 : tuple[1]
                },function(err, result) {
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


var requestForModule = module.exports.requestForModule = function(module) {
    if (!module) {
        request({
                url: urlToJobSystem,
                method: 'GET',
                json: true
            },
            function(err, resp, body) {
                var dependencys = {}
                if (!err && resp.statusCode == 200) {
                    helpers.moduleDataBuilder(body.module, function(err, data) {
                        if (err) {
                            requestForModule()
                        } else {
                            dbInsert(data)
                        }

                    })
                } else {
                    console.log("Something went wrong, here is the response code and the error")
                    console.log(resp.statusCode)
                    console.log(err)
                }
            })
    } else {
        console.log("New Module to Work On")
        helpers.moduleDataBuilder(module, function(err, data) {
            if (err) {
                requestForModule()
            } else {
                dbInsert(data)
            }
        })
    }
}
