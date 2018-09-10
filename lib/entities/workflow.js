const StepFunction = require("./StepFunction");

class Workflow {
    constructor(workflow) {
        this.name = workflow.name;
        this.workflow = workflow;
        this.functions = [];
    }

    addFunction(stepFunction) {
        this.functions.push(stepFunction);
    }

    toString() {
        console.log("test");
        let functions = "";
        this.functions.forEach(stepFunction => {
            functions = functions + stepFunction.functionName + ", ";
        });
        functions = functions.substring(0, functions.length - 2); // "12345.0"

        return `Workflow name: ${this.name},\nFunctions: [${functions}]`;
    }
}

module.exports = Workflow;