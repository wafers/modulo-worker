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
    // Rank by time since last module update. Longer time => lower score.
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

    // Rank by total number of published module updates.
    module.versionNumberRank = Object.keys(module.time).length < 35 ? 3 * (Object.keys(module.time).length-2) : 100; // versionNumberRank gives 3pts per published update, max 100 pts.

    // Rank by number of downloads in past 30 days.
    if (!module.monthlyDownloadSum) {
      module.downloadRank = 0;
    } else { // If there are downloads, min score is 10. Score moves up from there on log10 scale. Max score of 100 reached at 1million monthly downloads.
      module.downloadRank = Math.log10(module.monthlyDownloadSum)*15+10 > 100 ? 100 : Math.floor(Math.log10(module.monthlyDownloadSum)*15+10);
    }

    // Rank by number of NPM stars and Github stars. 
    if (!module.starred || !module.watchers) {
      module.starRank = 0;
    } else { // NPM stars added to GitHub stars, then scaled on log10. Max score of 100 reached at 10,000 combined stars.
      module.starRank = Math.floor(Math.log10(module.starred+module.watchers)*25) > 100 ? 100 : Math.floor(Math.log10(module.starred+module.watchers)*25);
    }

    // Rank by number of modules listing this module as a dependency
    if (!module.dependentsSize) {
      module.dependentRank = 0;
    } else {
      module.dependentRank = Math.log10(module.dependentsSize)*25 > 100 ? 100 : Math.floor(Math.log10(module.dependentsSize)*25) ;
    }

    // Rank by NPM module submission completeness (quality module must have Readme, Keywords, and URL)
    // Store lacking pieces for rank explanations
    module.completenessRank = 0;
    if (module.readme !== 'No readme provided') {
      module.completenessRank += 34;
    } else {
      module.completenessFailures = ['Readme'];
    }
    if (module.url && module.url.length > 0) {
      module.completenessRank += 33;
    } else {
      if (module.completenessFailures) module.completenessFailures.push('URL')
      else module.completenessFailures = ['URL']; 
    }
    if (module.keywords && module.keywords.length > 0) {
      module.completenessRank += 33;
    } else {
      if (module.completenessFailures) module.completenessFailures.push('Keywords')
      else module.completenessFailures = ['Keywords']; 
    }

    // Rank by GitHub followers, forks, and open issues/pulls
    if (!module.subscribers || !module.forks || !module.openIssues) {
      module.githubRank = 0;
    } else {
      // Count users watching repo for 33 of 100 points. Scaled on log10 with max score of 33 reached at 1500 users watching. 
      var watchersPortion = Math.floor(Math.log10(module.subscribers)*31.5/100*33) > 33 ? 33 : Math.floor(Math.log10(module.subscribers)*31.5/100*33);
      // Count forked repos for 34 of 100 points. Scaled on log10 with max score of 34 reached at 1000 forks. 
      var forkPortion = Math.floor(Math.log10(module.forks)*33/100*34) > 34 ? 34 : Math.floor(Math.log10(module.forks)*33/100*34);
      // Count issues+pulls for 33 of 100 points. Scaled on log10 with max score of 33 reached at 150 open issues/pulls.
      var issuesPortion = Math.floor(Math.log10(module.openIssues)*46/100*33) > 33 ? 33 : Math.floor(Math.log10(module.openIssues)*46/100*33);
      module.githubRank = watchersPortion + forkPortion + issuesPortion;
    }

    // Calculate overall rank as average of individual rankings
    var rankSum = (module.dateRank + module.versionNumberRank + module.downloadRank + module.starRank + module.dependentRank + module.completenessRank + module.githubRank)
    module.overallRank = Math.floor(rankSum/7)
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
      module.dependentsSize = module.dependents.length;
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
