const StateManager = require("./stateManager");

const express = require('express');
const bodyParser = require("body-parser");
const app = express();
const stateManager = new StateManager();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/stepExecution', (req, res) => {
    console.log(req.body);
    let workflowName = req.body.workflowName;
    let stepName = req.body.stepName;
    let coldExecution = req.body.coldExecution;
    let workflowUuid = req.body.workflowUuid;
    let stepExecutionUuid = req.body.stepExecutionUuid;
    let instanceUuid = req.body.instanceUuid;
    let receiveTime = req.body.receiveTime;
    let lastExecutionDuration = req.body.lastExecutionDuration;
    let lastNetworkLatencyToNextStep = req.body.lastNetworkLatencyToNextStep;

    stateManager.addStepExecution(workflowName, stepName, workflowUuid, stepExecutionUuid, instanceUuid, receiveTime, lastExecutionDuration, lastNetworkLatencyToNextStep, coldExecution);

    res.send('Got a POST request');
});

app.listen(8080, () => {
    console.log('Listening on incoming reports of serverless workflow executions on port 8080!');
});