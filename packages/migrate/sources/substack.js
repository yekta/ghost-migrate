const mgJSON = require('@tryghost/mg-json');
const mgHtmlMobiledoc = require('@tryghost/mg-html-mobiledoc');
const MgWebScraper = require('@tryghost/mg-webscraper');
const MgImageScraper = require('@tryghost/mg-imagescraper');
const MgMediaScraper = require('@tryghost/mg-mediascraper');
const MgLinkFixer = require('@tryghost/mg-linkfixer');
const fsUtils = require('@tryghost/mg-fs-utils');
const makeTaskRunner = require('../lib/task-runner');
const csvIngest = require('@tryghost/mg-substack-csv');
const {slugify} = require('@tryghost/string');

const scrapeConfig = {
    posts: {
        meta_title: {
            selector: 'title'
        },
        meta_description: {
            selector: 'meta[name="description"]',
            attr: 'content',
            convert: (x) => {
                if (!x) {
                    return;
                }
                return x.slice(0, 499);
            }
        },
        og_image: {
            selector: 'meta[property="og:image"]',
            attr: 'content'
        },
        og_title: {
            selector: 'meta[property="og:title"]',
            attr: 'content'
        },
        og_description: {
            selector: 'meta[property="og:description"]',
            attr: 'content',
            convert: (x) => {
                if (!x) {
                    return;
                }
                return x.slice(0, 499);
            }
        },
        twitter_image: {
            selector: 'meta[name="twitter:image"], meta[name="twitter:image:src"]',
            attr: 'content'
        },
        twitter_title: {
            selector: 'meta[name="twitter:title"]',
            attr: 'content'
        },
        twitter_description: {
            selector: 'meta[name="twitter:description"]',
            attr: 'content',
            convert: (x) => {
                return x.slice(0, 499);
            }
        },
        authors: {
            selector: 'script[type="application/ld+json"]',
            convert: (x) => {
                let ldJSON = JSON.parse(x);
                let author = ldJSON.author.name;
                let theAuthors = [];

                // Split string by ['and', '&', ','], trim white space from the resulting array items, and remove empty items
                let authorSplit = author.split(/(?:,|and|&)+/).map(function (item) {
                    return item.trim();
                }).filter(i => i);

                authorSplit.forEach((item) => {
                    theAuthors.push({
                        url: slugify(item),
                        name: item
                    });
                });

                return theAuthors;
            }
        },
        labels: {
            listItem: '.post-header > .post-label > a',
            name: 'labels',
            data: {
                url: {
                    attr: 'href',
                    convert: (x) => {
                        const urlParts = x.match(/.*\/s\/([a-zA-Z0-9-_]{1,})(\/.*)?/);
                        return urlParts[1]; // [1] is the tag name itself from `https://dummysite.substack.com/s/my-tag/?utm_source=substack`
                    }
                },
                name: {
                    convert: (x) => {
                        return x;
                    }
                }
            }
        }
    }
};

const skipScrape = (post) => {
    return post.data.status === 'draft';
};

/**
 * getTasks: Steps to Migrate from Medium
 *
 * Wiring of the steps to migrate from medium.
 *
 * @param {String} pathToFile
 * @param {Object} options
 */
module.exports.getTaskRunner = (pathToFile, options) => {
    let runnerTasks = [
        {
            title: 'Initializing',
            task: (ctx, task) => {
                ctx.options = options;

                // If enabled, set the `og:image` as the feature image
                if (options.useMetaImage) {
                    scrapeConfig.posts.feature_image = {
                        selector: 'meta[property="og:image"]',
                        attr: 'content'
                    };
                }

                // Delete the authors meta field if the option is not enabled (this data is fetched regardless of options passed)
                if (!options.useMetaAuthor) {
                    delete scrapeConfig.posts.authors;
                }

                // 0. Prep a file cache, scrapers, etc, to prepare for the work we are about to do.
                ctx.fileCache = new fsUtils.FileCache(pathToFile);
                ctx.imageScraper = new MgImageScraper(ctx.fileCache);

                ctx.sizeReports = {};
                ctx.mediaScraper = new MgMediaScraper(ctx.fileCache, {
                    sizeLimit: ctx.options.size_limit || false
                });

                ctx.webScraper = new MgWebScraper(ctx.fileCache, scrapeConfig, null, skipScrape);
                ctx.linkFixer = new MgLinkFixer();

                task.output = `Workspace initialized at ${ctx.fileCache.cacheDir}`;
            }
        },
        {
            title: 'Read csv file',
            task: async (ctx) => {
                // 1. Read the csv file
                try {
                    ctx.result = await csvIngest(ctx);
                    await ctx.fileCache.writeTmpFile(ctx.result, 'csv-export-data.json');
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        },
        {
            title: 'Fetch missing data via WebScraper',
            task: (ctx) => {
                // 2. Pass the results through the web scraper to get any missing data
                let tasks = ctx.webScraper.hydrate(ctx); // eslint-disable-line no-shadow

                let webScraperOptions = options;
                webScraperOptions.concurrent = 1;
                return makeTaskRunner(tasks, webScraperOptions);
            },
            skip: () => !options.url || ['all', 'web'].indexOf(options.scrape) < 0
        },
        {
            title: 'Build Link Map',
            task: async (ctx) => {
                // 3. Create a map of all known links for use later
                try {
                    ctx.linkFixer.buildMap(ctx);
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        },
        {
            title: 'Format data as Ghost JSON',
            task: (ctx) => {
                // 4. Format the data as a valid Ghost JSON file
                try {
                    ctx.result = mgJSON.toGhostJSON(ctx.result, ctx.options);
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        },
        {
            title: 'Fetch images via ImageScraper',
            task: async (ctx) => {
                // 5. Pass the JSON file through the image scraper
                let tasks = ctx.imageScraper.fetch(ctx); // eslint-disable-line no-shadow
                return makeTaskRunner(tasks, options);
            },
            skip: () => ['all', 'img'].indexOf(options.scrape) < 0
        },
        {
            title: 'Fetch media via MediaScraper',
            task: async (ctx) => {
                // 6. Pass the JSON file through the file scraper
                let tasks = ctx.mediaScraper.fetch(ctx);
                return makeTaskRunner(tasks, options);
            },
            skip: () => ['all', 'media'].indexOf(options.scrape) < 0
        },
        {
            title: 'Update links in content via LinkFixer',
            task: async (ctx, task) => {
                // 7. Process the content looking for known links, and update them to new links
                let tasks = ctx.linkFixer.fix(ctx, task); // eslint-disable-line no-shadow
                return makeTaskRunner(tasks, options);
            }
        },
        {
            // @TODO don't duplicate this with the utils json file
            title: 'Convert HTML -> MobileDoc',
            task: (ctx) => {
                // 8. Convert post HTML -> MobileDoc
                try {
                    let tasks = mgHtmlMobiledoc.convert(ctx); // eslint-disable-line no-shadow
                    return makeTaskRunner(tasks, options);
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        },
        {
            title: 'Write Ghost import JSON File',
            task: async (ctx) => {
                // 9. Write a valid Ghost import zip
                try {
                    await ctx.fileCache.writeGhostImportFile(ctx.result);
                    await ctx.fileCache.writeErrorJSONFile(ctx.errors);
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        },
        {
            title: 'Report file sizes',
            skip: () => !options.size_limit,
            task: async (ctx) => {
                // 10. Report assets that were not downloaded
                try {
                    ctx.sizeReports.media = await ctx.fileCache.writeReportCSVFile(ctx.mediaScraper.sizeReport, {filename: 'media', sizeLimit: options.size_limit});
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        },
        {
            title: 'Write Ghost import zip',
            skip: () => !options.zip,
            task: async (ctx) => {
                // 11. Write a valid Ghost import zip
                try {
                    ctx.outputFile = fsUtils.zip.write(process.cwd(), ctx.fileCache.zipDir, ctx.fileCache.defaultZipFileName);
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }
            }
        }
    ];

    // Configure a new Listr task manager, we can use different renderers for different configs
    return makeTaskRunner(runnerTasks, Object.assign({topLevel: true}, options));
};
