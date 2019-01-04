const clone = require('clone');
const Sntp = require('sntp');
const uuidv1 = require('uuid/v1');
const hinting = require("./util/hinting");
const Instance = require("./entities/workflow/function/instance");
const DEFAULT_START_HIT_DIFFERENCE = 1;

class StateSimulator {

    constructor() {
        this.offset = 0;
        this.pendingHints = [];
        this.connectTimes = {};
        this.hitDifference = {};
        Sntp.offset((err, timeOffset) => {
            this.offset = timeOffset;
        });
    }

    executeOptimization(stateManager, sendHints = true) {
        return new Promise((resolve, reject) => {
            const start = new Date().getTime();
            const clonedStateManager = clone(stateManager);

            // 1. Calculate how long a workflow can take in worst case
            let interval = 20;
            let untilTimestamp = 0;
            // Worst case time for workflow is when all instances are cold:
            clonedStateManager.functions.forEach(stepFunction => {
                let averageMetrics = stepFunction.getMetricsAvg(true);
                if (null === averageMetrics) averageMetrics = stepFunction.getMetricsAvg(false);
                for (let metric in averageMetrics) {
                    // We calculate the maximum workflow execution duration if all steps were cold
                    untilTimestamp = untilTimestamp + averageMetrics[metric];
                }
                // We calculate the interval such that the simulation runs three times for the step with the shortest execution duration
                // if (averageMetrics && averageMetrics.executionDuration / 3 < interval) interval = averageMetrics.executionDuration / 3;
            });

            let simulatedNow = new Date().getTime() + this.offset;
            untilTimestamp = untilTimestamp + new Date().getTime() + this.offset;

            // 2. Simulate how the state will change during the time of a workflow execution in worst case (from now until the calculated timestamp).
            let simulatedColdStarts;
            let simulatedState = {coldStarts: [], instancesAtTime: []};
            let simulatedInstances;
            let newColdStarts = [];
            if (untilTimestamp - simulatedNow > 0) simulatedState = this.simulateState(clonedStateManager, simulatedNow, untilTimestamp, interval);
            simulatedColdStarts = simulatedState.coldStarts;
            simulatedInstances = simulatedState.instancesAtTime;
            simulatedColdStarts.forEach((newColdStart, index, array) => {
                let timeTillColdStart = newColdStart.coldStartAtTimestamp - (new Date().getTime() + this.offset);
                let coldStart = Object.assign({timeTillColdStart: timeTillColdStart}, newColdStart);
                if (timeTillColdStart > 0 && timeTillColdStart) {
                    newColdStarts.push(coldStart);
                }
            });

            // 3. Remove cold start if for the same function a hint is still pending
            this.pendingHints.forEach(pendingHintGroup => {
                let pendingStarts = pendingHintGroup.requiredStarts;
                let functionMetrics = clonedStateManager.getFunction(pendingHintGroup.functionName).getMetricsAvg(true);
                if (!functionMetrics) functionMetrics = clonedStateManager.getFunction(pendingHintGroup.functionName).getMetricsAvg(false);
                let hintTime = functionMetrics ? pendingHintGroup.hintTime.time + functionMetrics.initDuration : pendingHintGroup.hintTime.time;
                let allColdStartsChecked = false;
                while (newColdStarts.length > 0 && !allColdStartsChecked && pendingStarts > 0) {
                    for (let i = 0; i < newColdStarts.length; i++) {
                        if (i === newColdStarts.length - 1) allColdStartsChecked = true;
                        if (newColdStarts[i].functionName === pendingHintGroup.functionName && hintTime < newColdStarts[i].coldStartAtTimestamp) {
                            newColdStarts.splice(i, 1);
                            // console.log(`Removed cold start from new cold start list since a hint for function ${pendingHintGroup.functionName} is still pending`);
                            pendingStarts--;
                            break;
                        }
                    }
                }
            });

            // 4. Time hints the way they most likely hit cold instances
            newColdStarts.forEach((coldStart, coldStartIndex) => {
                const coldStartTime = coldStart.coldStartAtTimestamp;

                // If no connect time has been measured yet (because no hint was sent until now), we set
                // connect time to 70. Otherwise (if we would set it to 0) the hint is timed too close
                // to the actual cold start.
                /** Time until TCP connection established (and TLS handshake done): cf. https://blog.risingstack.com/measuring-http-timings-node-js/ **/
                    // TODO make initial connect time configurable using the config
                let connectTime = clonedStateManager.getFunction(coldStart.functionName).provider === "aws" ? 10 : 10;
                if (this.connectTimes[coldStart.functionName]) {
                    connectTime = 0;
                    for (let singleConnectTime of this.connectTimes[coldStart.functionName]) {
                        connectTime += singleConnectTime;
                    }
                    connectTime = connectTime / this.connectTimes[coldStart.functionName].length;
                }

                let hintTime = -1;
                let utilization = -1;
                let idleInstances = -1;
                let warmInstances = -1;
                let hintTimeMinusLatencyDuration = -1;
                let timeUntilHint = -1;
                simulatedInstances.forEach(simulatedInstances => {
                    if (coldStart.functionName === simulatedInstances.functionName && simulatedInstances.time < coldStartTime) {
                        let newHintTime = simulatedInstances.time;
                        let newUtilization = (simulatedInstances.numberWarmInstances - simulatedInstances.numberIdleInstances) / simulatedInstances.numberWarmInstances;
                        let newWarmInstances = simulatedInstances.numberWarmInstances;
                        let newIdleInstances = simulatedInstances.numberIdleInstances;
                        let newHintTimeMinusLatencyDuration = newHintTime - (connectTime + simulatedInstances.functionInitDuration);
                        let newTimeUntilHint = newHintTimeMinusLatencyDuration - (new Date().getTime() + this.offset);
                        if (newUtilization > utilization && newTimeUntilHint > 0) {
                            // New utilization must be higher than the old one and the hint time must be in the future
                            hintTime = newHintTime;
                            utilization = newUtilization;
                            idleInstances = newIdleInstances;
                            warmInstances = newWarmInstances;
                            hintTimeMinusLatencyDuration = newHintTimeMinusLatencyDuration;
                            timeUntilHint = newTimeUntilHint;
                        }
                    }
                });

                newColdStarts[coldStartIndex].hintTime = {
                    timeUntilHint: timeUntilHint,
                    time: hintTimeMinusLatencyDuration,
                    utilization: utilization,
                    idleInstances: idleInstances,
                    warmInstances: warmInstances
                };
            });

            // 5. Group cold starts by function in order to send all hints at once
            // 5.1 Sort cold starts with regard to the remaining time until cold start occurs
            let groupedColdStarts = {};
            newColdStarts.sort((a, b) => {
                if (a.timeTillColdStart < b.timeTillColdStart) return -1;
                if (a.timeTillColdStart > b.timeTillColdStart) return 1;
                return 0;
            });
            // 5.2 Group forecasted cold starts by function name
            for (let index = 0; index < newColdStarts.length; index++) {
                // Hints are not allowed to be long term in the future, since forecast gets too imprecise. We rather
                // wait for the next simulation rounds which are closer to the actual cold start event and not seconds away.
                if (newColdStarts[index].hintTime.utilization > 0 && newColdStarts[index].hintTime.timeUntilHint < 1000) {
                    if (groupedColdStarts[newColdStarts[index].functionName]) {
                        groupedColdStarts[newColdStarts[index].functionName].requiredStarts = groupedColdStarts[newColdStarts[index].functionName].requiredStarts + 1;
                    } else {
                        groupedColdStarts[newColdStarts[index].functionName] = {
                            requiredStarts: 1,
                            timeTillFirstColdStart: newColdStarts[index].timeTillColdStart,
                            functionName: newColdStarts[index].functionName,
                            firstColdStartAtTimestamp: newColdStarts[index].coldStartAtTimestamp,
                            hintTime: newColdStarts[index].hintTime
                        };
                    }
                }
            }

            if (newColdStarts.length > 0) {
                console.log(`-------------------------------------------------------- Forecasted cold starts: ${newColdStarts.length}`);
                // console.log(groupedColdStarts);
                /* newColdStarts.forEach(value => {
                    console.log(JSON.stringify(value))
                })*/
            }

            // 6. send hints for each function at the calculated time all at once
            for (let functionName in groupedColdStarts) {

                let hitDifference = DEFAULT_START_HIT_DIFFERENCE; // over-provisioning to avoid under-provisioning at the first requests where we do not have any measurements
                if (this.hitDifference[functionName]) {
                    hitDifference += this.hitDifference[functionName];
                }
                hitDifference = Math.ceil(hitDifference);

                const hostname = clonedStateManager.getFunction(functionName).endpoint.hostname;
                const path = clonedStateManager.getFunction(functionName).endpoint.path;
                const provider = clonedStateManager.getFunction(functionName).provider;
                const requiredHints = groupedColdStarts[functionName].hintTime.idleInstances + groupedColdStarts[functionName].requiredStarts + hitDifference; // TODO make the +2 dynamic
                const stepName = clonedStateManager.getFunction(functionName).stepNames.join();
                const timeout = groupedColdStarts[functionName].hintTime.timeUntilHint;
                const optimizationMode = 5;
                const id = uuidv1();

                this.pendingHints.push({
                    id: id,
                    functionName: functionName,
                    requiredStarts: groupedColdStarts[functionName].requiredStarts,
                    hintTime: groupedColdStarts[functionName].hintTime
                });

                if (sendHints) {
                    hinting.sendHints(id, hostname, path, provider, requiredHints, stepName, optimizationMode, timeout).then(hintGroupResult => {
                        let newInstances = 0;
                        hintGroupResult.hintResults.forEach(singleHintResult => {
                            // update the connect time for that function hint
                            if (singleHintResult.connectTime >= 0) {
                                // time until TCP connection established (and TLS handshake done): cf. https://blog.risingstack.com/measuring-http-timings-node-js/
                                if (this.connectTimes[functionName]) {
                                    this.connectTimes[functionName].push(singleHintResult.connectTime);
                                } else {
                                    this.connectTimes[functionName] = [singleHintResult.connectTime];
                                }
                            }

                            // update the original state
                            if (singleHintResult.wasCold === 1) {
                                let newFunctionInstance = new Instance(singleHintResult.functionInstanceUuid);
                                newFunctionInstance.setStateIdle();
                                let originalFunction = stateManager.getFunction(singleHintResult.stepName);
                                originalFunction.addInstance(newFunctionInstance);
                                console.log("Created new instance in original state");
                                newInstances++;
                            }

                            // remove hint group from pending list
                            let pendingHintGroupIndex = -1;
                            this.pendingHints.forEach((pendingHintGroup, index) => {
                                if (pendingHintGroup.id === hintGroupResult.id) {
                                    pendingHintGroupIndex = index;
                                }
                            });
                            if (pendingHintGroupIndex >= 0) this.pendingHints.splice(pendingHintGroupIndex, 1);
                        });

                        // update the hint hit difference for that function
                        let newHitDifference = groupedColdStarts[functionName].requiredStarts - newInstances;
                        if (this.hitDifference[functionName]) {
                            if (newHitDifference > 0) {
                                this.hitDifference[functionName] += 1;
                            } else if (newHitDifference < 0) {
                                this.hitDifference[functionName] -= 0.5;
                            }
                        } else {
                            if (newHitDifference > 0) {
                                this.hitDifference[functionName] = 1;
                            } else if (newHitDifference < 0) {
                                this.hitDifference[functionName] = -0.5;
                            }
                        }

                        console.log(`$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ INFO: ${newInstances} new Instances for ${functionName} created, while asked for ${groupedColdStarts[functionName].requiredStarts}. Time until hint: ${timeout}; warm instances ${groupedColdStarts[functionName].hintTime.warmInstances}; idle instances ${groupedColdStarts[functionName].hintTime.idleInstances}; hitDifference ${hitDifference}; utilization ${groupedColdStarts[functionName].hintTime.utilization}`);
                    }).catch(reason => {
                        // Log error
                        console.error("Error when sending hints");
                        console.error(reason);
                        // remove hint group from pending list
                        let pendingHintGroupIndex = -1;
                        this.pendingHints.forEach((pendingHintGroup, index) => {
                            if (pendingHintGroup.id === id) {
                                pendingHintGroupIndex = index;
                            }
                        });
                        if (pendingHintGroupIndex >= 0) this.pendingHints.splice(pendingHintGroupIndex, 1);
                    });
                }
            }

            // resolve when hints returned and the state was updated
            const duration = new Date().getTime() - start;
            if (duration > 90) {
                console.log(`!!!!!!!!!!!!!!!!!!!!!! warn: simulation duration is ${duration}`);
                // console.log(`Simulated timeframe: ${untilTimestamp - simulatedNow}`);
            }
            resolve(duration);
        });
    }

    simulateState(clonedStateManager, simulatedNowStart, untilTimestamp, interval) {
        let coldStarts = [];
        let instancesAtTime = [];
        let simulatedNow = simulatedNowStart;
        let arrivingWorkflows = [];

        // console.log("Starting simulation round");
        while (simulatedNow < untilTimestamp && clonedStateManager.pendingWorkflowExecutions.length > 0) {

            /** Simulate existing workflow execution steps **/
            clonedStateManager.pendingWorkflowExecutions.forEach((workflowExecution, index, array) => {
                let currentFunction = clonedStateManager.getFunction(workflowExecution.currentStepExecution.functionName);
                let currentWorkflow = clonedStateManager.getWorkflow(workflowExecution.currentStepExecution.workflowName);
                const timeSinceStepStart = simulatedNow - workflowExecution.currentStepExecution.startTime;
                // console.log(`Current function: ${currentFunction.toString()}`);
                // console.log(`Current workflow execution: ${workflowExecution}`);
                // console.log(`Time since current step execution start: ${timeSinceStepStart}`);

                let currentFunctionMetrics = currentFunction.getMetricsAvg(workflowExecution.currentStepExecution.coldExecution) ? currentFunction.getMetricsAvg(workflowExecution.currentStepExecution.coldExecution) : currentFunction.getMetricsAvg(!workflowExecution.currentStepExecution.coldExecution);
                // console.log(`Time since start ${timeSinceStepStart}, execution duration: ${JSON.stringify(currentFunctionMetrics)}`);
                if (currentFunctionMetrics && timeSinceStepStart > currentFunctionMetrics.executionDuration) {
                    let nextFunctionResult = StateSimulator.getNextFunction(clonedStateManager, currentWorkflow.workflow, workflowExecution.currentStepExecution.stepName);
                    let nextFunction = nextFunctionResult.nextFunction;
                    let nextStepName = nextFunctionResult.nextStepName;
                    if (nextFunction) {
                        // console.log(`Simulated Workflow ${workflowExecution.workflowExecutionUuid}, Next function: ${nextFunction.name}`);
                        // console.log(`Current workflow execution: ${workflowExecution.currentStepExecution.stepName}`);
                        // console.log(`Time since current step execution start: ${timeSinceStepStart}`);
                        // Are there warm unused functions instances?
                        let nextFunctionStartTime = workflowExecution.currentStepExecution.startTime + currentFunctionMetrics.executionDuration;
                        let nextFunctionIsWarm = true;
                        const nextStepExecutionUuid = uuidv1();
                        let nextFunctionInstanceUuid;
                        const idleInstances = nextFunction.getIdleInstances();
                        const numberWarmInstances = nextFunction.warmInstances.length;
                        const numberBusyInstances = numberWarmInstances - idleInstances.length;
                        const utilization = (numberBusyInstances/numberWarmInstances);
						// todo: make target utilization dynamically configurable via a parameter at startup
                        const targetUtilization = 1;
						
                        if (idleInstances.length < 1 || utilization >= targetUtilization) {
                            nextFunctionIsWarm = false;
                            nextFunctionInstanceUuid = uuidv1();
                            let nextFunctionMetrics = nextFunction.getMetricsAvg(true) ? nextFunction.getMetricsAvg(true) : nextFunction.getMetricsAvg(false);
                            nextFunctionStartTime = nextFunctionMetrics ? nextFunctionStartTime + nextFunctionMetrics.executionOffset + nextFunctionMetrics.initDuration : nextFunctionStartTime;

                            if (nextFunctionMetrics) {
                                let coldStartAtTimestamp = workflowExecution.currentStepExecution.startTime + currentFunctionMetrics.executionDuration + nextFunctionMetrics.executionOffset;
                                let coldStartExists = -1;
                                coldStarts.forEach((coldStart, coldStartsIndex) => {
                                    if (coldStart.functionName === nextFunction.name && coldStart.triggeredFromWorkflowExecutionUuid === workflowExecution.workflowExecutionUuid) {
                                        coldStartExists = coldStartsIndex;
                                    }
                                });
                                // if (coldStartExists === -1) coldStarts.push({// leads to more hints and worse overall performance
                                if (coldStartExists === -1 && workflowExecution.workflowExecutionUuid.indexOf("simulated") === -1) coldStarts.push({
                                    functionName: nextFunction.name,
                                    coldStartAtTimestamp: coldStartAtTimestamp,
                                    triggeredFromWorkflowExecutionUuid: workflowExecution.workflowExecutionUuid
                                });
                            }
                        } else {
                            nextFunctionInstanceUuid = idleInstances[0].instanceUuid;
                            let nextFunctionMetrics = nextFunction.getMetricsAvg(false) ? nextFunction.getMetricsAvg(false) : nextFunction.getMetricsAvg(true);
                            nextFunctionStartTime = nextFunctionMetrics ? nextFunctionStartTime + nextFunctionMetrics.executionOffset + nextFunctionMetrics.initDuration : nextFunctionStartTime;
                        }

                        clonedStateManager.addStepExecution(workflowExecution.currentStepExecution.workflowName, nextStepName, workflowExecution.workflowExecutionUuid, nextStepExecutionUuid, nextFunctionInstanceUuid, !nextFunctionIsWarm, nextFunctionStartTime, null, true);
                    } else {
                        // Function might be final one for the workflow
                        if (currentWorkflow.workflow.workflow[workflowExecution.currentStepExecution.stepName].end === true || currentWorkflow.workflow.workflow[workflowExecution.currentStepExecution.stepName].end === "true") {
                            clonedStateManager.markExecutionFinished(workflowExecution.currentStepExecution.stepExecutionUuid, true);
                        }
                    }
                }
            });

            /** Simulate new arrival of workflow executions **/
            clonedStateManager.workflows.forEach((workflow, workflowsIndex) => {

                arrivingWorkflows[workflowsIndex] = arrivingWorkflows[workflowsIndex] ? arrivingWorkflows[workflowsIndex] + workflow.arrivalRate * interval / 1000 : workflow.arrivalRate * interval / 1000;
                const lastWorkflowStart = workflow.workflowStartTimes[workflow.workflowStartTimes.length - 1];

                if (arrivingWorkflows[workflowsIndex] >= 1 && lastWorkflowStart + 1000 / workflow.arrivalRate <= simulatedNow) {
                    let requiredNewWorkflows = Math.floor(arrivingWorkflows[workflowsIndex]);
                    arrivingWorkflows[workflowsIndex] = arrivingWorkflows[workflowsIndex] - requiredNewWorkflows;
                    for (let j = 0; j < requiredNewWorkflows; j++) {
                        const newWorkflowExecutionUuid = uuidv1();
                        const newStepExecutionUuid = uuidv1();
                        const firstFunction = clonedStateManager.getFunction(workflow.workflow.workflow[workflow.workflow.startAt].functionEndpoint.functionName);
                        const firstFunctionIdleInstances = firstFunction.getIdleInstances();
                        let firstFunctionIsWarm = firstFunctionIdleInstances.length > 0;
                        let firstFunctionInstanceUuid = uuidv1();
                        if (firstFunctionIsWarm) {
                            firstFunctionInstanceUuid = firstFunctionIdleInstances[0].instanceUuid;
                        }
                        //const startTime = lastWorkflowStart + (1 + j) * (1000 / workflow.arrivalRate);
                        const startTime = simulatedNow;
                        clonedStateManager.addStepExecution(workflow.name, workflow.workflow.startAt, "simulated" + newWorkflowExecutionUuid, newStepExecutionUuid, firstFunctionInstanceUuid, !firstFunctionIsWarm, startTime, null, true);
                    }
                }
            });

            /** 2. calculate for each simulated time the utilization of existing instances **/
            clonedStateManager.functions.forEach((stepFunction, index) => {
                const warmInstances = stepFunction.warmInstances;
                const idleInstances = stepFunction.getIdleInstances();
                const stepFunctionMetrics = stepFunction.getMetricsAvg(true) ? stepFunction.getMetricsAvg(true) : stepFunction.getMetricsAvg(false);
                const functionInitDuration = stepFunctionMetrics ? stepFunctionMetrics.initDuration : 0;
                instancesAtTime.push({
                    time: simulatedNow,
                    functionName: stepFunction.name,
                    functionInitDuration: functionInitDuration,
                    numberWarmInstances: warmInstances.length,
                    numberIdleInstances: idleInstances.length
                });
            });

            simulatedNow += interval;
        }

        return {coldStarts, instancesAtTime};
    }

    /**
     * Returns the corresponding function to the next step in the workflow definition (see JSON in assets).
     * @param stateManager An instance of the state manager. Either the original one or a cloned istance
     * @param workflow The workflow object parsed from the workflow definition (see JSON)
     * @param currentStep The current step to which we want to get the next function of.
     * @returns {*} The corresponding function to the next step in the workflow definition (see JSON in assets).
     */
    static getNextFunction(stateManager, workflow, currentStep) {
        let nextFunction = null;
        let nextStep;
        if (!(workflow.workflow[currentStep].end === true || workflow.workflow[currentStep].end === "true")) {
            switch (workflow.workflow[currentStep].type) {
                case "ChoiceTask":
                    nextStep = workflow.workflow[currentStep].choices[0].next;
                    // TODO this assumes that the workflow always branches in the first conditional function
                    break;
                case "Task":
                    nextStep = workflow.workflow[currentStep].next;
                    break;
                case "Fail":
                    // Current step is in Fail state which is always end state
                    nextStep = null;
                    break;
                default:
                    return new Error("Couldn't parse workflow step");
            }
            if (nextStep && workflow.workflow[nextStep].functionEndpoint) {
                nextFunction = stateManager.getFunction(workflow.workflow[nextStep].functionEndpoint.functionName);
            }
        }

        return {nextStepName: nextStep, nextFunction: nextFunction};
    }
}

module.exports = StateSimulator;