//@flow
const StepFunction = require("./function/stepFunction");

class Workflow {
    constructor(workflow: Object) {
        this.name = workflow.name;
        this.workflow = workflow;
        this.functions = [];
    }

    addFunction(stepFunction: StepFunction) {
        this.functions.push(stepFunction)
    }

    toString(): string {
        let functions = ""
        this.functions.forEach(stepFunction => {
            functions = functions + (stepFunction.name) + ", "
        });
        functions = functions.substring(0, functions.length - 2); // "12345.0"

        return `Workflow name: ${this.name},\nFunctions: [${functions}]`
    }
}

module.exports = Workflow;