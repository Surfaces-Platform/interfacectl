import http from "node:http";
import { URL } from "node:url";
import { AdapterInputError, runGenerationAdapter, } from "../adapter/core.js";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7777;
const DEFAULT_TOKEN_HEADER = "x-surfaces-adapter-token";
const MAX_REQUEST_BYTES = 1_000_000;
function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function redactSecrets(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => redactSecrets(entry));
    }
    if (!isObject(value)) {
        return value;
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
        if (/token|secret|password|authorization|api[_-]?key/i.test(key)) {
            output[key] = "[REDACTED]";
            continue;
        }
        output[key] = redactSecrets(entry);
    }
    return output;
}
function sendJson(res, statusCode, payload) {
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    res.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
    });
    res.end(body);
}
async function readBody(req) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_REQUEST_BYTES) {
            throw new AdapterInputError(`Request body exceeds ${MAX_REQUEST_BYTES} bytes.`);
        }
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.trim()) {
        throw new AdapterInputError("Request body must be valid JSON.");
    }
    try {
        const parsed = JSON.parse(raw);
        if (!isObject(parsed)) {
            throw new Error("Request body must be a JSON object.");
        }
        return parsed;
    }
    catch (error) {
        throw new AdapterInputError(`Invalid JSON body: ${error.message}`);
    }
}
export function createGenerationAdapterServer(config = {}) {
    const host = config.host ?? DEFAULT_HOST;
    const token = config.token;
    const tokenHeader = (config.tokenHeader ?? DEFAULT_TOKEN_HEADER).toLowerCase();
    const defaultBundleRoot = config.bundleRoot;
    const runtimeOptions = {
        cwd: process.cwd(),
        defaultBundleRoot,
        descriptorParityConfigPath: config.descriptorParityConfigPath,
    };
    if (host !== "127.0.0.1" && !token) {
        throw new AdapterInputError("Non-local bind requires a token. Set --token or SURFACES_ADAPTER_TOKEN.");
    }
    return http.createServer(async (req, res) => {
        try {
            const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host || host}`);
            if (req.method !== "POST" || requestUrl.pathname !== "/surfaces.validateGeneration") {
                sendJson(res, 404, {
                    error: "Not found",
                    path: requestUrl.pathname,
                });
                return;
            }
            if (token) {
                const providedToken = req.headers[tokenHeader];
                const headerValue = Array.isArray(providedToken)
                    ? providedToken[0]
                    : providedToken;
                if (headerValue !== token) {
                    sendJson(res, 401, {
                        error: "Unauthorized",
                        code: "adapter.auth",
                    });
                    return;
                }
            }
            const payload = await readBody(req);
            const requestPayload = {
                ...payload,
                ...(defaultBundleRoot ? { bundleRoot: defaultBundleRoot } : {}),
            };
            const response = await runGenerationAdapter(requestPayload, runtimeOptions);
            const statusCode = response.status === "block" ? 422 : 200;
            sendJson(res, statusCode, response);
            console.log(JSON.stringify({
                event: "surfaces.validateGeneration",
                status: response.status,
                requestId: response.requestId,
                tool: payload.tool,
                surfaceId: payload.surfaceId,
                findings: response.findings.length,
                timings: response.timings,
                payload: redactSecrets({
                    mode: payload.mode,
                    provenance: payload.provenance,
                }),
            }));
        }
        catch (error) {
            if (error instanceof AdapterInputError) {
                sendJson(res, 400, {
                    error: error.message,
                    code: error.code,
                });
                return;
            }
            sendJson(res, 500, {
                error: error instanceof Error ? error.message : String(error),
                code: "adapter.internal",
            });
        }
    });
}
export async function runServeGenerationAdapterCommand(options) {
    if (!options.bundleRoot) {
        throw new AdapterInputError("--bundle-root is required.");
    }
    const host = options.host ?? process.env.SURFACES_ADAPTER_HOST ?? DEFAULT_HOST;
    const portRaw = options.port ?? Number(process.env.SURFACES_ADAPTER_PORT ?? DEFAULT_PORT);
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new AdapterInputError(`Invalid port: ${portRaw}`);
    }
    const token = options.token ?? process.env.SURFACES_ADAPTER_TOKEN;
    const tokenHeader = options.tokenHeader ??
        (process.env.SURFACES_ADAPTER_TOKEN_HEADER || DEFAULT_TOKEN_HEADER).toLowerCase();
    const server = createGenerationAdapterServer({
        host,
        token,
        tokenHeader,
        bundleRoot: options.bundleRoot,
        descriptorParityConfigPath: options.descriptorParityConfigPath,
    });
    await new Promise((resolve) => {
        server.listen(port, host, () => {
            const address = server.address();
            const displayPort = typeof address === "object" && address ? address.port : port;
            console.log(`Generation adapter listening on http://${host}:${displayPort}/surfaces.validateGeneration`);
            resolve();
        });
    });
    const shutdown = () => {
        server.close(() => {
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
