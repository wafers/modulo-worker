// Imports
var Registry = require('npm-registry');
var downloadCount = require('npm-download-counts');
var moment = require('moment');
var _ = require('underscore');
var request = require('request');
var npm = new Registry({
  registry: "http://skimdb.npmjs.com/registry/",
  retries: 3
});
var db = require(__dirname + '/dbParsing.js');

// Configure github npm module
var GitHubApi = require('github');
var github = new GitHubApi({
    // required 
    version: "3.0.0",
    // optional 
    debug: true,
    protocol: "https",
    host: "api.github.com", // should be api.github.com for GitHub 
    pathPrefix: "", // for some GHEs; none for GitHub 
    timeout: 5000,
    headers: {
        "user-agent": "makersquare-was-here" // GitHub is happy with a unique user agent 
    }
});

///////////////// HELPER FUNCTIONS /////////////////

Math.log10 = Math.log10 || function(x) {
  return Math.log(x) / Math.LN10;
};

var calculateRank = module.exports.calculateRank = function(module) {
    if (module.lastUpdate === 'Unknown') {
      module.dateRank = 0;
    } else {
      var now = moment();
      var recent = moment().subtract(1,'day');
      var year = moment().subtract(1,'year');
      var moduleDate = moment(module.time.modified); // dateRank criteria: score of 100 if updated in last day, score of 0 if updated >= 1 year ago. Linear scale between.
      module.dateRank = Math.floor((100/(recent-year))*(moduleDate - now) + 100 - (100/(recent-year))*(recent-now))
      if (module.dateRank < 0 ) module.dateRank = 0;
    };
    module.versionNumberRank = Object.keys(module.time).length < 35 ? 3 * (Object.keys(module.time).length-2) : 100; // versionNumberRank gives 3pts per published update, max 100 pts.
    
    if (!module.monthlyDownloadSum) {
      module.downloadRank = 0;
    } else { // If there are downloads, min score is 40. Score moves up from there on log10 scale. Max score of 100 reached at 1million monthly downloads.
      module.downloadRank = Math.log10(module.monthlyDownloadSum)*10+40 > 100 ? 100 : Math.floor(Math.log10(module.monthlyDownloadSum)*10+40);
    }
    
    if (!module.starred) {
      module.starRank = 0;
    } else {
      module.starRank = module.starred.length > 50 ? 100 : 2 * module.starred.length;
    }

    if (!module.dependents.length) {
      module.dependentRank = 0;
    } else {
      module.dependentRank = Math.log10(module.dependents.length)*25 > 100 ? 100 : Math.floor(Math.log10(module.dependents.length)*25) ;
    }

    module.completenessRank = 0;
    if (module.readme !== 'No readme provided') module.completenessRank += 34;
    if (module.url && module.url.length > 0) module.completenessRank += 33;
    if (module.keywords && module.keywords.length > 0) module.completenessRank += 33;

    var rankSum = (module.dateRank + module.versionNumberRank + module.downloadRank + module.starRank + module.dependentRank + module.completenessRank)
    module.overallRank = Math.floor(rankSum/500 * 100) > 100 ? 100 : Math.floor(rankSum/500 * 100)

    return module;
  }

// Returns an array of all the dependents
var findDependents = module.exports.findDependents = function(module, cb){
  npm.packages.depended(module.name, function(err, data){
    if(err){
      cb(err, module);
    }else{
      module.dependents = data.map(function(row){
        return row.name;
      });
      cb(null, module);
    }
  })
}
// Returns an integer of the total # of downloads last month
var findMonthlyDownloads = module.exports.findMonthlyDownloads = function(module, cb){
  var start = moment().subtract(5, 'years').toDate();
  var end = new Date();

  downloadCount(module.name, start, end, function(err, downloadData) {
    if(err){
      console.log('findMonthlyDownloads ERROR:', module.name, err)
      module.downloads = [{ day: '2015-01-01', count: 0 }];
      module.monthlyDownloadSum = 0;
      cb(err,module);
    }else{
      if(downloadData === undefined){
        module.downloads = [{ day: '2015-01-01', count: 0 }];
        module.monthlyDownloadSum = 0;
        cb(null, module);
      }else{
          module.downloads = downloadData; // Daily download numbers
          module.monthlyDownloadSum = downloadSum(downloadData); // Total downloads for the past month
          function downloadSum(downloadData) {
            if(typeof downloadData !== "object"){
              console.log(downloadData)
              console.log(module.name)  
            }
            var days = Object.keys(downloadData);
            if (days && days.length > 0) {
              var lastMonth = days.slice(-30);
              var sum = 0;
              for (var i=0; i<lastMonth.length; i++) {
                sum += downloadData[lastMonth[i]]['count'];
              }
              return sum;
            }
          }
          cb(null, module);
        }
      }   
  })
}

///////////////// MAIN EXPORT FUNCTIONS /////////////////

// Used by the database for gathering detailed stats. Takes in a module name and sends back a stats object.
var moduleDataBuilder = module.exports.moduleDataBuilder = function(moduleName, cb){
  var module = {name: moduleName};
  console.log('Getting',moduleName);
  npm.packages.get(moduleName, function(err, results){

    if(err){
      console.log('moduleDataBuilder : npm.packages.get ERROR', err);
      cb(err, module);
      // write module to errorQueue
    } else if (results[0] && (results[0].description !== '' || results[0].starred || results[0].time)) {
      // Inside here i have access to the result[0].github = {user:'username', repo: 'repo-name'} object
      var githubConfig = results[0].github || undefined;
      module['description'] = results[0].description || 'None Provided';
      module['readme'] = results[0].readme || 'None Provided';
      module['time'] = results[0].time || 'None Provided';
      module['repository'] = results[0].repository || 'None Provided';
      module['url'] = results[0]['homepage'].url || 'None Provided'
      module['keywords'] = results[0].keywords || 'None Provided';
      module['starred'] = results[0].starred || 'None Provided';

      findMonthlyDownloads(module, function(err, moduleWithDownloads){
        findDependents(module, function(err, finalData){
          if (finalData.dependents && finalData.downloads){ // Check to make sure the data is good before sending to GitHub API
            if(githubConfig) github.repos.get(githubConfig, function(err, result){
              if(err){
                console.log('github-api grab error', err); 
                cb(err, null);
                return;
              } 
              console.log('Success!', moduleName, 'going back to DB now.')

              finalData['subscribers'] = result['subscribers_count'];
              finalData['forks'] = result['forks_count'];
              finalData['watchers'] = result['watchers_count'];
              finalData['openIssues'] = result['open_issues_count'];

              cb(null, finalData);
            });
          } else {
            console.log('Something went wrong in findDependents. Will try',moduleName,'again later.')
            console.log('dependents', finalData.dependents, 'downloads', finalData.downloads)
            // write module to errorQueue
          }
        })
      })      
    } else {
      console.log('Something went wrong in moduleDataBuilder. Will try',moduleName,'again later.')
      console.log('results[0] check:', results[0])
      console.log('results[0].description check:', results[0].description)
      console.log('results[0].starred check:', results[0].starred)
      // write module to errorQueue
    }
  });
}
