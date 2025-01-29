'use strict';

const request = require('request-promise-native');
const cheerio = require('cheerio');
const parseSrcSet = require('parse-srcset');
const TurndownService = require('turndown')
const fs = require('fs');
const path = require('path');
const converters = require('./mdConverters');
const dateFns = require('date-fns');
const {has} = require("cheerio/lib/api/traversing");


let urls = ["https://blog.nrwl.io/introducing-playwright-support-for-nx-d8108ee11d46"];

async function convertUrls() {
    let delay = 1000;
    for (let index = 0; index < urls.length; index++) {
        await new Promise(resolve => {
            console.log(`Waiting ${delay} for ${urls[index]}`);
            setTimeout(resolve, delay)
        })
        await convertFromUrl(urls[index]);
    }
}

async function convertFromUrl(url) {
    url = url.split('?')[0];

    const turndownService = new TurndownService({headingStyle: 'atx'})

    converters.forEach((converter) => {
        turndownService.addRule(converter.filter, converter)
    })

    let title, author, cover_image, tags, publish_date;

    const imagesToDownload = [];

    turndownService.addRule('mediumInlineLink', {
        filter: function (node, options) {
            return (options.linkStyle === 'inlined' && node.nodeName === 'A' && node.getAttribute('href'))
        },

        replacement: function (content, node) {
            var href = node.getAttribute('href')

            // following code added in to handle medium relative urls
            // otherwise the link to article "foo" in the new website would go to
            // https://newwebsite.com/@username/foo-a16a6fcf49c7 which doesn't exist
            if (href.startsWith('/')) {
                href = "https://medium.com" + href
            }

            var title = node.title ? ' "' + node.title + '"' : ''
            return '[' + content + '](' + href + title + ')'
        }
    })

    turndownService.addRule('author name', {
        filter: function (node, options) {
            return (node.nodeName === 'A' && node.getAttribute('href') && !author)
        },

        replacement: function (content, node) {
            author = node.textContent;
            return '';
        }
    })

// Medium has these weird hidden images that are in the html and get rendered
// by turndown. We filter these out.
    turndownService.addRule('noHiddenImages', {
        filter: function (node, options) {
            return (node.nodeName === 'IMG' && node.getAttribute('src') && node.getAttribute('src').endsWith('?q=20'))
        },

        replacement: function () {
            return ''
        }
    })

    turndownService.addRule('code blocks', {
        filter: 'pre', replacement: function (content, node) {
            let type = '';
            if (content.includes('npx') || content.includes('yarn') || content.includes('pnpm')) {
                type = 'shell';
            }

            if (content.startsWith('{')) {
                type = 'json';
            }
            return `\`\`\`${type}\n` + content + "\n```"
        }
    })

// medium uses h1s for section headers
    turndownService.addRule('section headers', {
        filter: 'h1', replacement: function (content, node) {
            if (!title) {
                title = content;
                return '';
            } else {
                return "\n## " + content + "\n";
            }
        }
    })

    turndownService.addRule('subsection headers', {
        filter: 'h2', replacement: function (content, node) {
            return "\n### " + content + "\n";
        }
    })

    const currentDir = __dirname;
    turndownService.addRule('source sets', {
        filter: 'figure', replacement: function (content, node) {
            const hasPictures = node.querySelectorAll('picture');
            if(hasPictures.length === 0) {
                return `>>> GO CHECK FOR GIST FROM ${url}`;
            }

            const source = node.querySelector('div div picture source');

            if (source) {
                const caption = node.querySelector('figcaption')
                const srcSet = parseSrcSet(source.srcset);
                const originalSource = srcSet[0].url.split('/').at(-1);

                if (originalSource && originalSource.length > 0) {
                    const originalUrl = `https://miro.medium.com/v2/format:avif/${originalSource}`;
                    let file = originalSource.split('.')[0].replace(/0\*|1\*_|1\*-|1\*/,'') + '.avif';
                    imagesToDownload.push([originalUrl, file]);

                    if (!cover_image) {
                        const ogUrl = `https://miro.medium.com/v2/format:png/resize:fit:1200/${originalSource}`;
                        let ogFile = originalSource.split('.')[0].replace(/0\*|1\*_|1\*-|1\*/,'') + '.png';
                        imagesToDownload.push([ogUrl, ogFile]);

                        cover_image = ogFile;
                        return '';
                    } else {
                        return `![${caption ?? ''}](/blog/images/${publish_date}/${file})\n${caption?.textContent ? '_' + caption.textContent + '_\n' : ''}`
                    }
                }
            } else {
                return `>>> GO GET VIDEO FROM ${url}`;
            }
        }
    })

    turndownService.addRule('follow link', {
        filter: (node, options) => node.nodeName === 'A' && node.textContent.includes('Follow'),
        replacement: function (content, node) {
            return '';
        }
    })

    turndownService.addRule('Published in', {
        filter: (node, options) => node.nodeName === 'SPAN' && (node.textContent === "--" || node.textContent === "·" || node.textContent.includes('Published in')),
        replacement: function (content, node) {
            return '';
        }
    })

    turndownService.remove('button')


    turndownService.addRule('date', {
        filter: (node, options) => node.nodeName === 'SPAN' && node.dataset?.testid === 'storyPublishDate',
        replacement: function (content, node) {
            publish_date = dateFns.lightFormat(dateFns.parse(node.textContent, 'MMM d, yyyy', new Date()), 'yyyy-MM-dd');
            return '';
        }
    });

    console.log(`Fetching ${url}`);
    let response;

    try {
        response = await request(url);
    } catch (e) {
        console.log(e);
        return;
    }

    if (response.includes("Just a moment")) {
        console.log('rate limited');
    }

    let $ = cheerio.load(response);
    let html = $('article').html() || '';

    let markdown = turndownService.turndown(html);
    
    console.log(`Fetching ${imagesToDownload.length} images for ${url}`);
    
    let delay = 1000;
    
    for (let index = 0; index < imagesToDownload.length; index++) {
        await new Promise(resolve => {
            console.log(`Waiting ${delay} for ${imagesToDownload[index]}`);
            setTimeout(resolve, delay)
        })
        const [from, to] = imagesToDownload[index];
        console.log(`Fetching image ${from}`);
        const response = await fetch(from);
        const buffer = await response.arrayBuffer();
    
        // Write the buffer to a file
        let dir = path.join(currentDir, '..', '/blog/images/', publish_date);
    
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
    
        fs.writeFile(path.join(dir, to), Buffer.from(buffer), (err) => {
            if (err) {
                console.error(err);
            }
        });
    }
    await Promise.all(imagesToDownload.map(([from, to], index) => {
        console.log(`Waiting ${delay * index} for image fetch`)
        return new Promise(resolve => setTimeout(resolve, delay * index)).then(async () => {
            console.log(`Fetching image ${from}`);
            const response = await fetch(from);
            const buffer = await response.arrayBuffer();
    
            // Write the buffer to a file
            let dir = path.join(currentDir, '..', '/blog/images/', publish_date);
    
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, {recursive: true});
            }
    
            fs.writeFile(path.join(dir, to), Buffer.from(buffer), (err) => {
                if (err) {
                    console.error(err);
                }
            });
    
        });
    }));

    if (cover_image) {
        cover_image = path.join('/blog/images/', publish_date, cover_image);
    }


    let slug = url.split('/').at(-1).split('-').slice(0, -1).join('-');
    let frontmatter = `---
title: '${title}'
slug: '${slug}'
authors: ['${author}']
cover_image: '${cover_image}'
tags: [nx, release]
---
`;
    let dir = path.join(currentDir, '..', 'blog');

    const file = `${publish_date}-${slug}.md`;


    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(path.join(dir, file), frontmatter + markdown, (err) => {
        if (err) {
            console.error(err);
        }
    });
}

module.exports = convertUrls;
