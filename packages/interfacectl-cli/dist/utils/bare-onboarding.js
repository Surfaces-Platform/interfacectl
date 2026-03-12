import readline from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { runInitCommand } from "../commands/init.js";
const FORCE_BARE_WELCOME_ENV = "INTERFACECTL_FORCE_BARE_WELCOME";
const ANSI = {
    reset: "\u001B[0m",
    bold: "\u001B[1m",
    cyan: "\u001B[36m",
    dim: "\u001B[2m",
};
function style(text, code, enabled) {
    return enabled ? `${code}${text}${ANSI.reset}` : text;
}
export function shouldLaunchBareWelcomeFlow(args = process.argv.slice(2)) {
    if (args.length > 0) {
        return false;
    }
    if (process.env[FORCE_BARE_WELCOME_ENV] === "1") {
        return true;
    }
    return Boolean(defaultInput.isTTY && defaultOutput.isTTY);
}
function renderWelcomeScreen(output) {
    const ansiEnabled = Boolean(output.isTTY);
    output.write(`${style("Surfaces Platform", ANSI.bold, ansiEnabled)}\n`);
    output.write(`${style("Extract your first contract and draft your first design system from a web surface.", ANSI.dim, ansiEnabled)}\n\n`);
    output.write(`Choose a source: ${style("[1]", ANSI.cyan, ansiEnabled)} Local app root  ${style("[2]", ANSI.cyan, ansiEnabled)} Live URL  ${style("[q]", ANSI.cyan, ansiEnabled)} Quit\n`);
    output.write(`${style("Advanced commands: init, analyze, validate, auth, --help", ANSI.dim, ansiEnabled)}\n\n`);
}
async function promptSourceSelection(input, output) {
    const rl = readline.createInterface({ input, output });
    try {
        while (true) {
            const answer = (await rl.question("> ")).trim().toLowerCase();
            if (answer === "1") {
                return "local-root";
            }
            if (answer === "2") {
                return "remote-url";
            }
            if (answer === "q") {
                return null;
            }
            output.write("Expected 1, 2, or q.\n");
        }
    }
    finally {
        rl.close();
    }
}
export async function runBareWelcomeFlow(options = {}) {
    const input = options.input ?? defaultInput;
    const output = options.output ?? defaultOutput;
    const initRunner = options.initRunner ?? runInitCommand;
    renderWelcomeScreen(output);
    const selectedSource = await promptSourceSelection(input, output);
    if (!selectedSource) {
        output.write("Exited onboarding.\n");
        return 0;
    }
    output.write("\n");
    return initRunner({
        extractMode: selectedSource,
    });
}
