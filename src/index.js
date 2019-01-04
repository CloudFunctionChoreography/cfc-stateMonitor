const StateManager = require("./stateManager");
const StateSimulator = require("./stateSimulator");

const express = require('express');
const bodyParser = require("body-parser");
const app = express();
let stateManager = new StateManager();
const stateSimulator = new StateSimulator();
let optimizationEnabled = false;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

let i = 0;
let seconds = 0;
setInterval(() => {
    /* console.log(`+++++++++++++++++++++++++++ Executing for ${seconds} seconds ++++++++++++++++++++++`);*/
    console.log(`Received step executions until now: ${i}`);
    seconds = seconds + 2;
}, 10000);

app.post('/stepExecution', (req, res) => {
    let start = new Date().getTime();
    res.send('Got a POST request');
    i++;
    // console.log(`+++++++++++++++++++++++Request ${i}+++++++++++++++++++++++++++++++++++++`)
    // console.log(req.body)
    let workflowName = req.body.workflowName;
    let stepName = req.body.stepName;
    let coldExecution = req.body.coldExecution;
    let workflowExecutionUuid = req.body.workflowExecutionUuid;
    let stepExecutionUuid = req.body.stepExecutionUuid;
    let instanceUuid = req.body.instanceUuid;
    let timeMetrics = req.body.timeMetrics;
    let requestOptimizationEnabled = req.body.optimizationMode;

    if (requestOptimizationEnabled === 5 && !optimizationEnabled) {
        // enable optimization
        console.log("****************************************** Enabling optimization ******************");
        optimizationEnabled = true;
    } else if (optimizationEnabled && 5 !== requestOptimizationEnabled) {
        // disable optimization
        console.log("****************************************** Disabling optimization ******************");
        optimizationEnabled = false;
    }

    stateManager.addStepExecution(workflowName, stepName, workflowExecutionUuid, stepExecutionUuid, instanceUuid, coldExecution, timeMetrics.startTime, timeMetrics);

    // console.log(`+++++++++++++++++++++++ Request ${i}: ${new Date().getTime() - start}ms +++++++++++++++++++++++++++++++++++++`)
});

app.post('/resetState', (req, res) => {
    i = 0;
    stateManager = new StateManager();
    console.log("State reset");
    res.send('State reset executed');
});

app.get('/functions', (req, res) => {

    let functionResponse = [];
    stateManager.functions.forEach(stepFunction => {
        let transformedInstances = [];
        stepFunction.warmInstances.forEach(instance => {
            transformedInstances.push({ instanceUuid: instance.instanceUuid, state: instance.state });
        });

        let transformedFunction = {
            functionName: stepFunction.name,
            provider: stepFunction.provider,
            warmInstances: transformedInstances,
            averageWarmMetrics: stateManager.getAverageMetrics(false, stepFunction.name),
            averageColdMetrics: stateManager.getAverageMetrics(true, stepFunction.name)
        };
        functionResponse.push(transformedFunction);
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(JSON.stringify(functionResponse));
});

app.listen(8080, () => {
    console.log('Listening on incoming reports of serverless workflow executions on port 8080!');
});

/**** Start simulator ****/
/* const recursiveCallback = () => {
    stateSimulator.executeOptimization(stateManager).then(duration => {
        const timeout = Math.max(50, duration);
        // const timeout = Math.max(75, duration);
        setTimeout(() => {
            recursiveCallback();
        }, timeout);
    }).catch(reason => {
        console.error(reason)
    })
};
recursiveCallback(); */

let simulationActive = false;
setInterval(() => {
    if (!simulationActive) {
        simulationActive = true;
        stateSimulator.executeOptimization(stateManager, optimizationEnabled).then(duration => {
            simulationActive = false;
        }).catch(reason => {
            simulationActive = false;
            console.error(reason);
        });
    }
}, 50);