'use strict';

const https = require('https');
const fs = require('fs');
let security = null;
const readSecurityFile = () => {
    fs.readFile('./assets/accessKeys.json', 'utf8', (err, data) => {
        if (err) {
            console.error(err);
        } else {
            security = JSON.parse(data);
        }
    });
};
readSecurityFile();

const sendHints = (hintRequestId, hostname, path, provider, requiredHints, stepName, optimizationMode = 5, timeout = 0) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            let counter = 0;
            const promises = [];
            while (counter < requiredHints) {
                let postObject = {
                    hintMessage: {
                        triggeredFrom: {
                            functionExecutionId: "stateMonitor",
                            functionInstanceUuid: "stateMonitor",
                            step: "stateMonitor",
                            wfState: "stateMonitor" // this is the workflow execution uuid
                        },
                        optimizationMode: optimizationMode,
                        stepName: stepName
                    }
                };

                if (provider === "openWhisk") {
                    promises.push(hintOpenWhisk(hostname, path, postObject));
                } else if ("aws") {
                    promises.push(hintLambda(hostname, path, postObject));
                }

                counter++;
            }

            Promise.all(promises).then(hintResults => {
                resolve({id: hintRequestId, hintResults: hintResults});
            }).catch(hintErrors => {
                reject(hintErrors);
            });
        }, timeout);
    });
};

const hintLambda = (hostname, path, postObject, blocking = true, blockTime = 0) => {
    return new Promise((resolve, reject) => {
        let now = new Date().getTime();
        let timings = {dnsLookupAt: -1, tcpConnectionAt: -1, tlsHandshakeAt: -1};

        setTimeout(() => {
            if (!blocking) resolve(`Sending hint to Lambda function ${hostname}${path}.`);
        }, blockTime);

        let invocationType = "Event";
        if (blocking) invocationType = "RequestResponse";

        const postData = JSON.stringify(postObject);
        const options = {
            hostname: hostname,
            path: path,
            method: 'POST',
            headers: {
                // By default, the Invoke API assumes RequestResponse invocation type.
                // You can optionally request asynchronous execution by specifying Event as the InvocationType.
                'X-Amz-Invocation-Type': invocationType,
                'X-Amz-Log-Type': 'None',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        let req = https.request(options, res => {
            res.setEncoding('utf8');
            let result = "";
            res.on('data', chunk => {
                result = result + chunk;
            });
            res.on('end', () => {
                if (blocking) resolve(Object.assign({connectTime: Math.max(timings.dnsLookupAt, timings.tcpConnectionAt, timings.tlsHandshakeAt)}, JSON.parse(JSON.parse(result).body).handlerResult));
            });
            /* res.resume();
            res.on('end', () => {
                console.log(`Lambda function was hinted ${hostname}${path}`);
            }); */
        });

        req.on('socket', socket => {
            socket.on('lookup', () => {
                timings.dnsLookupAt = new Date().getTime() - now;
            });
            socket.on('connect', () => {
                timings.tcpConnectionAt = new Date().getTime() - now;
            });
            socket.on('secureConnect', () => {
                timings.tlsHandshakeAt = new Date().getTime() - now;
            });
        });

        req.on('error', err => {
            console.log(`Lambda function was hinted BUT error: ${err.message}`);
            if (blocking) reject(err.message);
        });

        // write data to request body
        req.write(postData);
        req.end();
    });
};

const hintOpenWhisk = (hostname, path, postObject, blocking = true, blockTime = 0) => {
    return new Promise((resolve, reject) => {

        let now = new Date().getTime();
        let timings = {dnsLookupAt: -1, tcpConnectionAt: -1, tlsHandshakeAt: -1};
        setTimeout(() => {
            if (!blocking) resolve(`Sending hint to OpenWhisk function ${hostname}${path}.`);
        }, blockTime);

        let blockingPath = "?blocking=false";
        if (blocking) blockingPath = "?blocking=true";

        const postData = JSON.stringify(postObject);
        const auth = 'Basic ' + Buffer.from(security.openWhisk.owApiAuthKey + ':' + security.openWhisk.owApiAuthPassword).toString('base64');
        const options = {
            hostname: hostname,
            path: path + blockingPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Authorization': auth
            }
        };

        let req = https.request(options, res => {
            res.setEncoding('utf8');
            let result = "";
            res.on('data', chunk => {
                result = result + chunk;
            });
            res.on('end', () => {
                if (blocking) resolve(Object.assign({connectTime: Math.max(timings.dnsLookupAt, timings.tcpConnectionAt, timings.tlsHandshakeAt)}, JSON.parse(result).response.result));
            });
        });

        req.on('socket', socket => {
            socket.on('lookup', () => {
                timings.dnsLookupAt = new Date().getTime() - now;
            });
            socket.on('connect', () => {
                timings.tcpConnectionAt = new Date().getTime() - now;
            });
            socket.on('secureConnect', () => {
                timings.tlsHandshakeAt = new Date().getTime() - now;
            });
        });

        req.on('error', err => {
            console.log(`OpenWhisk function was hinted BUT error: ${err.message}`);
            if (blocking) reject(err);
        });

        // write data to request body
        req.write(postData);
        req.end();
    });
};

exports.sendHints = sendHints;