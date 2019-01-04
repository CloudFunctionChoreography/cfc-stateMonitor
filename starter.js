const psTree = require('ps-tree');
const express = require('express');
const bodyParser = require("body-parser");
const app = express();
const spawn = require('child_process').spawn;
let subprocess = null;
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
/***
 * This express.js server is only used for automated benchmarking and can start and stop
 * a new process with a running stateMonitor in it using HTTP POST endpoints.
 ***/

/**
 * Starts a new state monitor in a new shell process
 */
const startStateMonitor = () => {
    const args = [
        "run",
        "start"
    ];
    subprocess = spawn('npm', args);
    subprocess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    subprocess.stderr.on('data', (data) => {
        console.log(`stderr: ${data}`);
    });

    subprocess.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        subprocess = null;
    });
};

/**
 * Kills the processes and sub-processes for the given pid
 */
const kill = (pid, signal, callback) => {
    signal   = signal || 'SIGKILL';
    callback = callback || function () {};
    var killTree = true;
    if(killTree) {
        psTree(pid, function (err, children) {
            [pid].concat(
                children.map(function (p) {
                    return p.PID;
                })
            ).forEach(function (tpid) {
                try { process.kill(tpid, signal) }
                catch (ex) { }
            });
            callback();
        });
    } else {
        try { process.kill(pid, signal) }
        catch (ex) { }
        callback();
    }
};


/**
 * Express.js server with endpoints to start and stop the stateMonitor
 */
app.post('/startMonitor', (req, res) => {
    startStateMonitor();
    console.log("Request received to start cfc-stateMonitor");
    res.send('Starting cfc-stateMonitor');
});

app.post('/stopMonitor', (req, res) => {
    if (subprocess) {
        kill(subprocess.pid);
        console.log("Request received to stop cfc-stateMonitor");
        res.send('Stopping cfc-stateMonitor');
    } else {
        console.log("No subprocess started to stop");
        res.send('Could not stop because it was not running');
    }
});

app.listen(8081, () => {
    console.log('Listening on incoming requests to start cfc-stateMonitor on port 8081!');
});