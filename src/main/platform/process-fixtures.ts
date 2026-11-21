export const fixtureNow = Date.UTC(2026, 10, 21, 10, 10, 0);

export const psMacos = String.raw`    1     0     1 Ss   Mon Nov  2 08:00:00 2026     /sbin/launchd
  900     1   900 Ss   Sat Nov 21 09:00:00 2026     /Applications/Satellite.app/Contents/MacOS/Satellite
 4100   900  4100 Ss+  Sat Nov 21 10:00:00 2026     claude --session-id 11111111-1111-4111-8111-111111111111
 4110  4100  4100 S+   Sat Nov 21 10:00:02 2026     node /srv/tools/language-server --stdio
 4111  4110  4100 S+   Sat Nov 21 10:00:03 2026     node /srv/tools/language-worker
 4200  4100  4200 Ss   Sat Nov 21 10:05:00 2026     /bin/zsh -c source /srv/snapshot.sh && eval 'npm run dev'
 4201  4200  4200 S    Sat Nov 21 10:05:01 2026     npm run dev
 4202  4201  4200 S    Sat Nov 21 10:05:02 2026     sh -c vite --port 5173
 4203  4202  4200 S    Sat Nov 21 10:05:02 2026     node /srv/app/node_modules/.bin/vite --port 5173
 4300  4100  4300 Ss   Sat Nov 21 10:09:55 2026     /bin/zsh -c git status
 4301  4300  4300 R    Sat Nov 21 10:09:56 2026     git status
 4400  4100  4400 Ss   Sat Nov 21 10:06:00 2026     /bin/zsh -c node /srv/app/worker.js one\012two
 4401  4400  4400 Z    Sat Nov 21 10:06:01 2026     <defunct>
 4402  4400  4400 S    Sat Nov 21 10:06:01 2026     node /srv/app/worker.js one\012two
 5000     1  5000 S    Sat Nov 21 09:30:00 2026     node /srv/other/server.js
 5001   900   900 S    Sat Nov 21 10:07:00 2026     /bin/ps -A -ww -o pid= -o ppid= -o pgid= -o stat= -o lstart= -o command=`;

export const psLinux = String.raw`      1       0       1 Ss   Mon Nov  2 08:00:00 2026 /sbin/init
      2       0       0 S    Mon Nov  2 08:00:00 2026 [kthreadd]
   2100    1900    2100 Ssl+ Sat Nov 21 10:00:00 2026 claude
   2200    2100    2200 Ss   Sat Nov 21 10:05:00 2026 /bin/bash -c pnpm dev
   2201    2200    2200 Sl   Sat Nov 21 10:05:01 2026 node /srv/app/node_modules/.bin/pnpm dev
   2202    2201    2200 Z    Sat Nov 21 10:05:02 2026 [sh] <defunct>`;

export const psBusybox = String.raw`PID   USER     TIME  COMMAND
    1 root      0:00 /sbin/init
   12 root      0:00 node /srv/app/server.js`;

export const tableWindows = String.raw`[{"p":0,"pp":0,"s":null,"n":"System Idle Process","c":null},{"p":4,"pp":0,"s":1793606400000,"n":"System","c":null},{"p":3100,"pp":2900,"s":1795255200000,"n":"claude.exe","c":"C:\\Tools\\claude.exe --session-id 11111111-1111-4111-8111-111111111111"},{"p":3200,"pp":3100,"s":1795255500000,"n":"bash.exe","c":"\"C:\\Program Files\\Git\\bin\\bash.exe\" -c \"npm run dev\""},{"p":3201,"pp":3200,"s":1795255501000,"n":"node.exe","c":"node C:\\srv\\app\\server.js --port 3000"},{"p":3300,"pp":3201,"s":1795251600000,"n":"notepad.exe","c":null}]`;

export const lsofMacos = [
  "p4203",
  "f12",
  "tIPv6",
  "PTCP",
  "n*:5173",
  "f13",
  "tIPv4",
  "PTCP",
  "n127.0.0.1:9229",
  "f14",
  "tIPv6",
  "PTCP",
  "n[::1]:9230",
  "p4402",
  "f9",
  "tIPv4",
  "PTCP",
  "n192.168.1.20:8080",
  "f10",
  "tIPv4",
  "PTCP",
  "n*:8081",
].join("\n");

export const ssLinux = String.raw`LISTEN 0      511        127.0.0.1:3000       0.0.0.0:*    users:(("node",pid=2201,fd=19))
LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*
LISTEN 0      511                *:5173             *:*    users:(("node",pid=2201,fd=21),("node",pid=2203,fd=21))
LISTEN 0      128             [::]:8080          [::]:*    users:(("python3",pid=2300,fd=3))
LISTEN 0      128    [fe80::1%eth0]:9000         [::]:*    users:(("node",pid=2201,fd=22))`;

export const portsWindows = String.raw`[{"a":"0.0.0.0","p":3000,"o":3201},{"a":"::","p":3000,"o":3201},{"a":"192.168.1.20","p":8080,"o":3201},{"a":"::1","p":9229,"o":3201}]`;
