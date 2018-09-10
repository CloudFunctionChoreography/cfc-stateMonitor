//@flow
const Workflow = require("../workflow");
const Queue = require("../../queue");

class StepFunction {

    constructor(functionName: string, provider: string, endpoint: {
        functionName: string,
        type: string,
        hostname: string,
        path: string
    }) {
        this.name = functionName;
        this.provider = provider;
        this.endpoint = endpoint;
        this.queue = new Queue();
        this.warmInstances = [];
        this.removedInstances = [];
        this.assignedWorkflows = [];
        this.metrics = {executionDurations: [], initTimes: [], networkLatencies: []};
    }

    toString() {
        let assignedWorkflowsStr = [];
        this.assignedWorkflows.forEach(workflow => {
            assignedWorkflowsStr.push(workflow.name)
        });
        return JSON.stringify({
            name: this.name,
            provider: this.provider,
            assignedWorkflows: assignedWorkflowsStr,
            averageMetrics: this.getMetricsAvg()
        })
    }

    addAssignedWorkflows(workflow: Workflow) {
        this.assignedWorkflows.push(workflow)
    }

    addNetworkLatencyMetric(lastNetworkLatencyToNextStep) {
        this.metrics.networkLatencies.push(lastNetworkLatencyToNextStep)
    }

    addExecutionDurationMetric(lastExecutionDuration) {
        this.metrics.executionDurations.push(lastExecutionDuration)
    }

    addInitTimeMetric(initTime) {
        this.metrics.initTimes.push(initTime)
    }

    getMetricsAvg() {
        let avgExecutionDuration = -1;
        if (this.metrics.executionDurations.length > 0) {
            avgExecutionDuration = 0;
            this.metrics.executionDurations.forEach(value => {
                avgExecutionDuration = avgExecutionDuration + value
            });
            avgExecutionDuration = avgExecutionDuration/this.metrics.executionDurations.length;
        }

        let avgNetworkLatency = -1;
        if (this.metrics.networkLatencies.length > 0) {
            avgNetworkLatency = 0;
            this.metrics.networkLatencies.forEach(value => {
                avgNetworkLatency = avgNetworkLatency + value
            });
            avgNetworkLatency = avgNetworkLatency/this.metrics.networkLatencies.length;
        }

        let avgInitTime = -1;
        if (this.metrics.initTimes.length > 0) {
            avgInitTime = 0;
            this.metrics.initTimes.forEach(value => {
                avgInitTime = avgInitTime + value
            });
            avgInitTime = avgInitTime/this.metrics.initTimes.length;
        }

        return {avgInitTime, avgExecutionDuration, avgNetworkLatency}
    }

    addInstance(instance: Instance): Instance {
        this.warmInstances.push(instance)
        return instance
    }

    removeInstance(instance: Instance): Instance {
        // TODO not tested yet
        const arrayIndex = this.warmInstances.indexOf(instance);
        this.removedInstances.push(this.warmInstances[arrayIndex]);
        this.warmInstances.splice(arrayIndex, 1);
        return instance
    }

    getInstance(uuid: string): Instance {
        let result = null
        for (let instance of this.warmInstances) {
            if (instance.instanceUuid === uuid) {
                result = instance;
                break;
            }
        }
        if (result === null) {
            for (let instance of this.removedInstances) {
                if (instance.instanceUuid === uuid) {
                    result = instance;
                    break;
                }
            }
        }
        return result
    }

    getPendingStepExecutions(): Array<StepExecution> {
        // TODO not tested yet

        let result = [];
        for (let instance of this.warmInstances) {
            instance.pendingStepExecutions.forEach(stepExecution => {
                result.push(stepExecution)
            })
        }
        return result
    }

    getFinishedStepExecutions(): Array<StepExecution> {
        // TODO not tested yet

        let result = [];
        for (let instance of this.warmInstances) {
            instance.pendingStepExecutions.forEach(stepExecution => {
                result.push(stepExecution)
            })
        }
        for (let instance of this.removedInstances) {
            instance.pendingStepExecutions.forEach(stepExecution => {
                result.push(stepExecution)
            })
        }
        return result
    }
}

module.exports = StepFunction;