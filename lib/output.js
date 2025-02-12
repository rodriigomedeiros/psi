'use strict';
const sortOn = require('sort-on');
const humanizeUrl = require('humanize-url');
const prettyMs = require('pretty-ms');
const terminalLink = require('terminal-link');
const {getThreshold, getReporter} = require('./../lib/options-handler');
const {getLink} = require('./../lib/string-utils');
const fs = require('fs');

function overview(url, strategy, scores) {
  return [
    {
      label: 'URL',
      value: url
    },
    {
      label: 'Strategy',
      value: strategy
    },
    {
      label: 'Performance',
      value: convertToPercentum(scores.categories.performance.score)
    }
  ];
}

const fieldData = stats => {
  const ret = [];

  for (const title in stats) {
    if (Object.prototype.hasOwnProperty.call(stats, title)) {
      ret.push({
        label: title,
        value: prettyMs(stats[title].percentile)
      });
    }
  }

  return sortOn(ret, 'label');
};

const getRules = (rules, group) => rules.filter(rule => rule.group === group);

const labData = lighthouseResult => {
  const {audits, categories} = lighthouseResult;
  const rules = getRules(categories.performance.auditRefs, 'metrics');

  const ret = rules.map(rule => {
    const {title, displayValue} = audits[rule.id];
    return {
      label: title,
      value: displayValue.replace(/\s/g, '')
    };
  });

  return sortOn(ret, 'label');
};

const getTitle = (title, description) => {
  let output = title;
  if (description) {
    const link = getLink(description);
    if (link) {
      output = terminalLink(title, getLink(description));
    }
  }

  return output;
};

const opportunities = (lighthouseResult, links) => {
  const {audits, categories} = lighthouseResult;
  const rules = getRules(categories.performance.auditRefs, 'load-opportunities');

  const opportunityRules = rules.filter(rule => {
    const {details} = audits[rule.id];
    return Boolean(details) && details.type === 'opportunity' && details.overallSavingsMs > 0;
  });

  const ret = opportunityRules.map(rule => {
    const {title, details, description} = audits[rule.id];

    return {
      label: links ? getTitle(title, description) : title,
      value: prettyMs(details.overallSavingsMs)
    };
  });

  return sortOn(ret, 'label');
};

const convertToPercentum = num => Math.round(num * 100);
const isInTest = typeof global.it === 'function';

module.exports = (parameters, response) => {
  return Promise.resolve().then(() => {
    const {format, strategy, filePath} = parameters;

    const renderer = require(`./formats/${getReporter(format)}`);
    const threshold = getThreshold(parameters.threshold);
    const {lighthouseResult, loadingExperience = {}, id} = response;
    const humanizedUrl = humanizeUrl(id);

    const render = renderer(
      overview(humanizedUrl, strategy, lighthouseResult),
      fieldData(loadingExperience.metrics),
      labData(lighthouseResult),
      opportunities(lighthouseResult, parameters.links),
      threshold
    );

    console.log(render);

    if (parameters.toFile && format === 'json' && !isInTest) {
      const urlFilename = humanizedUrl.replaceAll('.', '-').replaceAll('/', '--');

      const dateFilename = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/\D/g, '');

      const jsonFileName = `${filePath ? filePath + '/' : ''}${urlFilename}_${strategy}_${dateFilename}`;

      const responseJsonStringfy = JSON.stringify(response);

      fs.writeFileSync(`${jsonFileName}_short.json`, render, err => {
        if (err) {
          return console.error(err);
        }
      });

      fs.writeFileSync(
        `${jsonFileName}_full.json`,
        responseJsonStringfy,
        err => {
          if (err) {
            return console.error(err);
          }
        }
      );
    }

    const score = convertToPercentum(lighthouseResult.categories.performance.score);
    if (score < threshold) {
      const error = new Error(`Threshold of ${threshold} not met with score of ${score}`);
      error.noStack = true;
      throw error;
    }
  });
};
