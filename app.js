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



dbParser.requestForModule();