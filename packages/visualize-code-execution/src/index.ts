import fs from "fs";
import path from "path";
import os from "os";
import { execSync, spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { Frame, Step, Variables } from "./types.js";

export async function visualizeCodeExecution(html: string): Promise<string> {
  const codes = html.matchAll(
    /<code [^>]*? data-visualize-execution[^>]*?>([\w\W]*?)<\/code>/gm
  );

  for (const result of Array.from(codes).reverse()) {
    const startIndex = result.index;
    const endIndex = result.index + result[0].length;

    const visualizationCode = await codeExecutionVisualization(result[1]);
    html = html.slice(0, endIndex) + visualizationCode + html.slice(endIndex);
  }

  return html;
}

function cleanUpCode(code: string): string {
  if (code.startsWith("\n")) {
    code = code.slice(1);
  }
  if (!code.match(/fn main\(\)/gm)) {
    code = `fn main() {
${code}
}`;
  }

  code = code.replaceAll(/^.*?\/\/ Error.*?$/gm, "");
  code = code.replaceAll(/&lt;/gm, "<");
  code = code.replaceAll(/&amp;/gm, "&");
  code = code.replaceAll(/&gt;/gm, ">");

  return code;
}

async function codeExecutionVisualization(rustCode: string): Promise<string> {
  let code = cleanUpCode(rustCode);
  const cratePath = createTmpCrate(code);

  execSync("cargo build --target-dir target", {
    cwd: cratePath,
  });
  let steps = await executeAndDebugProgram(cratePath);

  if (!rustCode.includes("fn main()")) {
    steps = steps.map((step) =>
      step.map((frame) => ({ ...frame, line: frame.line - 1 }))
    );
  }

  const id = `rust-execution-visualizer-${uuidv4()}`;
  const arrowId = `arrow-${uuidv4()}`;

  return `<rust-execution-visualizer id="${id}" style="color: black; position: absolute; right: -15%; top: 0; width: 420px"></rust-execution-visualizer>

    <span id="${arrowId}" style="position: absolute; top: 0; left: -10px; margin-top: 5px; display: none;">⮕</span>

      <script-fragment>
        <script type="text/template">
          document.querySelector("#${id}").displayChanged = true;
          document.querySelector("#${id}").frames = JSON.parse('${JSON.stringify(
    steps[0]
  ).replaceAll("\\", "\\\\")}');
          document.querySelector("#${arrowId}").style.display = "block";
          document.querySelector("#${arrowId}").style.top = '${
    1.25 * (steps[0][0].line - 1)
  }em';
        </script>
        <script data-on-hide type="text/template">
          document.querySelector("#${id}").displayChanged = false;
          document.querySelector("#${id}").frames = [];
          document.querySelector("#${arrowId}").style.display = "none";
        </script>
      </script-fragment>
    ${steps
      .slice(1)
      .map(
        (step, i) => `
      <script-fragment>
        <script type="text/template">
          document.querySelector("#${id}").displayChanged = true;
          document.querySelector("#${id}").frames = JSON.parse('${JSON.stringify(
          step
        ).replaceAll("\\", "\\\\")}');
          document.querySelector("#${arrowId}").style.top = '${
          1.25 * (step[0].line - 1)
        }em';
        </script>
        <script data-on-hide type="text/template">
          document.querySelector("#${id}").displayChanged = false;
          document.querySelector("#${id}").frames = JSON.parse('${JSON.stringify(
          steps[i]
        ).replaceAll("\\", "\\\\")}');
          document.querySelector("#${arrowId}").style.display = "block";        
          document.querySelector("#${arrowId}").style.top = '${
          1.25 * (steps[i][0].line - 1)
        }em';
        </script>
      </script-fragment>
      `
      )
      .join("")}
      <script-fragment>
        <script type="text/template">
          document.querySelector("#${arrowId}").style.display = "none";        
          document.querySelector("#${id}").frames = [];
        </script>
        <script data-on-hide type="text/template">
          document.querySelector("#${id}").displayChanged = false;
          document.querySelector("#${arrowId}").style.display = "block";
          document.querySelector("#${id}").frames = JSON.parse('${JSON.stringify(
    steps[steps.length - 1]
  ).replaceAll("\\", "\\\\")}');
        </script>
      </script-fragment>
    `;
}

function createTmpCrate(code: string): string {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "visualize-code-execution")
  );
  fs.mkdirSync(`${tmpDir}/src`);

  fs.writeFileSync(`${tmpDir}/Cargo.toml`, cargoToml());
  fs.writeFileSync(`${tmpDir}/src/main.rs`, code);

  return tmpDir;
}

function cargoToml() {
  return `[package]
name = "inline-code"
version = "0.1.0"
edition = "2021"

[profile.dev]
opt-level = 0
`;
}

async function executeAndDebugProgram(cratePath: string): Promise<Step[]> {
  const rustGdb = spawn("rust-gdb", ["target/debug/inline-code"], {
    cwd: cratePath,
  });

  const code = fs.readFileSync(`${cratePath}/src/main.rs`).toString();
  const codeLines = code.split("\n");
  const codeLinesNumber = codeLines.length;

  const fnMatches = code.matchAll(/fn ([a-zA-Z\_0-9]+)\(/gm);

  await expect(rustGdb, "(gdb) ");

  for (const fnMatch of [...fnMatches]) {
    await runAndExpect(rustGdb, `break ${fnMatch[1]}`, /\(gdb\) $/gm, 3000);
  }
  await runAndExpect(rustGdb, "run", /\(gdb\) $/gm, 3000, 1000);
  await runAndExpect(rustGdb, "next", /.*/gm, 5000, 1000);

  const steps: Step[] = [];

  while (true) {
    const frameMatches = await runAndExpect(
      rustGdb,
      "backtrace full",
      /#(\d) .*? inline_code::(?:.*?::)*(.*?) \((.*?)\) at src\/(.*?).rs:(\d+)\n([^#]*)/gm
    );

    const frames: Frame[] = [];

    for (let i = 0; i < frameMatches.length; i++) {
      const match = frameMatches[i];
      const variables: Variables = {};

      const functionArguments = match[3]
        .split(", ")
        .filter((a) => a !== "")
        .map((arg) => arg.split("=")[0]);

      const variablesNames = functionArguments;

      const localVars = match[6];

      if (!localVars.includes("No locals.")) {
        const varMatches = localVars.matchAll(/\s*([^= ]+?) = [^\n]+/gm);
        for (const varName of [...varMatches]) {
          if (!variablesNames.includes(varName[1])) {
            variablesNames.push(varName[1]);
          }
        }
      }
      await runAndExpect(rustGdb, `frame ${i}`, /.*/gm);

      for (const varName of variablesNames) {
        const typeMatches = await runAndExpect(
          rustGdb,
          `whatis ${varName}`,
          /[^=]* = (.*)/gm
        );
        const type = typeMatches[0][1];

        const addressMatches = await runAndExpect(
          rustGdb,
          `print &${varName}`,
          /^[^=]* = .+ 0x(.+)$/gm
        );
        const address = `0x${addressMatches[0][1]}`;

        const isReference = type.includes("*mut");
        const getValueCommand = isReference
          ? `print *${varName}`
          : `print ${varName}`;

        const printMatches = await runAndExpect(
          rustGdb,
          getValueCommand,
          /[^=]* = (.*)$/gm
        );

        const value = printMatches[0][1];

        variables[varName] = {
          address,
          type,
          value,
        };
      }

      frames.push({
        fn_name: match[2],
        line: parseInt(match[5]),
        variables,
      });
    }
    steps.push(frames);

    try {
      await runAndExpect(rustGdb, "next", /\(gdb\)/gm);
    } catch (e) {}
    let whereMatches = await runAndExpect(
      rustGdb,
      "where",
      /#0[\s\S]*?\s+at\s*? (.*?):(\d+)$/gm,
      5000,
      100
    );
    if (
      parseInt(whereMatches[0][2]) === codeLinesNumber ||
      whereMatches[0][0].includes("__rust_begin_short_backtrace")
    ) {
      break;
    }
  }

  console.log(JSON.stringify(steps));

  rustGdb.stdin.write("q\n");

  return steps;
}

async function expect(child, expectation, timeout = 3000) {
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      if (typeof expectation === "string") {
        if (data.toString() === expectation) resolve(data.toString());
      } else {
        const results = [...data.toString().matchAll(expectation)];
        if (results.length > 0) resolve(results);
      }
    });
    child.stderr.on("data", (data) => reject(data.toString()));

    setTimeout(() => reject("Timeout reached"), timeout);
  });
}

async function runAndExpect(
  child,
  command: string,
  expectation: RegExp,
  timeout = 3000,
  stdoutTimeout = 10
): Promise<RegExpMatchArray[]> {
  return new Promise((resolve, reject) => {
    let result = "";
    child.stdin.write(command + "\n");
    child.stdout.on("data", (data) => (result += data.toString() + "\n"));
    child.stderr.on("data", (data) => reject(data.toString()));
    setTimeout(() => {
      const results = [...result.matchAll(expectation)];
      if (results.length > 0) resolve(results);
    }, stdoutTimeout);
    setTimeout(() => reject("Timeout reached"), timeout);
  });
}

async function runAndExpectString(
  child,
  command: string,
  expectation: string,
  timeout = 3000,
  stdoutTimeout = 50
): Promise<void> {
  return new Promise((resolve, reject) => {
    let result = "";
    child.stdin.write(command + "\n");
    child.stdout.on("data", (data) => (result += data.toString() + "\n"));
    child.stderr.on("data", (data) => reject(data.toString()));
    setTimeout(() => {
      if (result === expectation) resolve(undefined);
    }, stdoutTimeout);
    setTimeout(() => reject("Timeout reached"), timeout);
  });
}