import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { appendStandInEvent } from "./stand-in-log.ts";

const idleChild = "setInterval(() => {}, 1000);";

const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const child = spawn(process.execPath, ["-e", idleChild], { stdio: "ignore" });
  if (typeof address !== "object" || address === null || child.pid === undefined) {
    process.exit(1);
  }
  appendStandInEvent({ type: "server", pid: process.pid, port: address.port, child: child.pid });
});
