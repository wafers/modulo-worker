var request = require('request');
var helpers = require(__dirname + '/helpers.js')
var dbParser = require(__dirname + '/dbParsing.js')
var helpers = require(__dirname + '/helpers.js')
var config = (process.env.DATABASE_URL) ? process.env.DATABASE_URL : require(__dirname + '/config');
var dbRemote = require("seraph")({
    user: process.env.DATABASE_USER || config.db.username,
    pass: process.env.DATABASE_PASS || config.db.password,
    server: process.env.DATABASE_URL || config.db.dbURL,
});
var urlToJobSystem = process.env.joburl||config.joburl


request({
        url: urlToJobSystem
        method: 'GET',
        json: true
    },
    function(err, resp, body) {
        var dependencys = {}
        if (!err && resp.statusCode == 200) {
            helpers.moduleDataBuilder(body.module, function(err, data) {
                dbParser.dbInsert(data)
            })
        } else {
            console.log("Something went wrong, here is the response code and the error")
            console.log(resp.statusCode)
            console.log(err)
        }
    })
