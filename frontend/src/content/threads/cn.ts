import type { Thread } from "./types";

const TCP_VS_UDP_ARTIFACT_ID = "artifact-cn-tcp-vs-udp";

const tcpVsUdp: Thread = {
  label: "TCP vs UDP",
  subject: "CN",
  mode: "ask",
  placeholder: "Ask anything about Computer Networks...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Today · Computer Networks",
  blocks: [
    { from: "system", text: "Today · Computer Networks", variant: "divider" },
    {
      from: "user",
      attachments: [
        { id: "seed-cn-1", name: "CN Lecture 07.pdf", mime: "application/pdf", size: 2457600 },
        { id: "seed-cn-2", name: "CN textbook", mime: "application/pdf", size: 18944000 },
      ],
      bubbles: [
        {
          type: "mention",
          tokens: [{ value: "@cn", label: "@CN", variant: "blue" }],
          text: "@cn Can you explain TCP vs UDP from the lecture material, and tell me what I should write in a 5-mark exam answer?",
        },
      ],
      time: "2026-09-04T13:42:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "text",
          text: "I’ll combine your CN course material and keep this focused on what is useful for an exam.",
        },
        {
          type: "markdown",
          md: `### TCP vs UDP

- **TCP** prioritizes reliable, ordered delivery.
- **UDP** prioritizes low overhead and speed.

| Feature | TCP | UDP |
|---|---|---|
| Connection | Connection-oriented | Connectionless |
| Reliability | Reliable | Best effort |
| Ordering | Ordered | No guarantee |
| Flow control | Yes | No |
| Congestion control | Yes | No |
| Overhead | Higher | Lower |

For a **5-mark answer**, compare these properties and give suitable application examples.`,
        },
        {
          type: "code",
          title: "5-mark answer structure",
          language: "text",
          code: `1. TCP is connection-oriented; UDP is connectionless.
2. TCP provides reliable, ordered delivery; UDP does not.
3. TCP supports flow and congestion control.
4. TCP has more overhead; UDP has a smaller header.
5. TCP suits reliability-sensitive applications; UDP suits low-latency traffic.`,
        },
      ],
      toolCalls: [
        {
          name: "retrieve",
          target: "CN Lecture 07.pdf",
          status: "complete",
          duration: "42ms",
        },
        {
          name: "search",
          target: "CN textbook · TCP / UDP",
          status: "complete",
          duration: "67ms",
        },
        {
          name: "retrieve",
          target: "CN lecture recording · Transport Layer",
          status: "complete",
          duration: "91ms",
        },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-09-04T13:42:14",
      footer: "PESDac · CN",
    },
    {
      from: "system",
      text: "Sources used: Course Slides · Textbook · Lecture Recordings",
    },
    {
      from: "user",
      bubbles: [{ type: "text", text: "Turn that into a quick revision sheet." }],
      time: "2026-09-04T13:44:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "text",
          text: "Done. I made it short enough for last-minute revision.",
        },
        { type: "artifactCard", artifactId: TCP_VS_UDP_ARTIFACT_ID },
      ],
      toolCalls: [
        {
          name: "generate",
          target: "CN Revision Sheet: TCP vs UDP",
          status: "complete",
          duration: "118ms",
        },
      ],
      time: "2026-09-04T13:44:12",
    },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Nice. Test me on it." },
        {
          type: "text",
          text: "Give me a question to check whether I actually understand TCP vs UDP.",
        },
      ],
      time: "2026-09-04T13:45:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "quiz",
          md: `### Quick check

A video-calling application experiences occasional packet loss. Explain why it might prefer **UDP** over **TCP**, and what the application would need to handle itself because of that choice.

Send your answer and I’ll grade it like a short-answer exam question.`,
        },
      ],
      time: "2026-09-04T13:45:10",
    },
    {
      from: "user",
      bubbles: [
        {
          type: "text",
          text: "UDP, because retransmission delays would hurt a live call — the app handles ordering and loss concealment itself.",
        },
      ],
      time: "2026-09-04T13:46:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "text",
          text: "Correct — now try one the exam way, then measure it yourself in Wireshark.",
        },
        {
          type: "mcq",
          question:
            "A page holds index.html plus 9 images, fetched over non-persistent HTTP. How many TCP connections are opened in total?",
          options: [
            { label: "One connection for everything" },
            { label: "One connection per object — 10 total" },
            { label: "One UDP datagram per object" },
            { label: "Two connections: one for HTML, one for images" },
          ],
          answerIndex: 1,
          explanation:
            "Non-persistent HTTP opens a fresh TCP connection per object (1 HTML + 9 images = 10), closing each after the response.",
        },
        {
          type: "steps",
          title: "Record start/end timestamps for Non-Persistent",
          intro:
            "In the Wireshark packet list, find the very first HTTP packet (the initial GET for index.html) and note its Time value. Then find the very last HTTP packet (the final 200 OK response, likely for 10.jpg) and note its Time value. Subtract: Load Time = End Time − Start Time.",
          steps: [
            {
              heading: "Filter to HTTP",
              body: "Load your capture and apply the `http` display filter so only HTTP packets show in the list.",
            },
            {
              heading: "Find the first packet",
              body: "Locate the very first HTTP packet — the initial GET for index.html — and note its Time value. This is your Start Time.",
            },
            {
              heading: "Find the last packet",
              body: "Locate the very last HTTP packet — the final 200 OK response, likely for 10.jpg — and note its Time value. This is your End Time.",
            },
            {
              heading: "Subtract",
              body: "Load Time = End Time − Start Time. That gap covers all 10 connection setups plus transfers.",
            },
            {
              heading: "Sanity-check",
              body: "If the time looks near zero, confirm you read the Time column and not packet numbers — and that the capture actually used non-persistent connections.",
            },
          ],
        },
      ],
      toolCalls: [
        {
          name: "retrieve",
          target: "CN course slides",
          status: "complete",
          duration: "41ms",
        },
      ],
      time: "2026-09-04T13:46:20",
    },
  ],
  artifact: {
    id: TCP_VS_UDP_ARTIFACT_ID,
    title: "CN Revision Sheet: TCP vs UDP",
    subtitle:
      "Study note · Generated from Course Slides, Textbook & Lecture Recordings",
    markdown: `## TCP vs UDP

### Core idea

**TCP (Transmission Control Protocol)** is connection-oriented and focuses on reliable, ordered delivery.

**UDP (User Datagram Protocol)** is connectionless and focuses on low overhead and speed.

| Property | TCP | UDP |
|---|---|---|
| Connection | Connection-oriented | Connectionless |
| Reliability | Reliable delivery | Best effort |
| Ordering | Ordered | No ordering guarantee |
| Flow control | Yes | No |
| Congestion control | Yes | No |
| Header overhead | Higher | Lower |
| Typical use | Web, file transfer, email | DNS, streaming, real-time traffic |

### 5-mark exam shortcut

Remember:

**TCP = reliability**
**UDP = speed / low overhead**

For a 5-mark answer, compare connection setup, reliability, ordering, flow control, congestion control, overhead, and common applications.`,
  },
};

const osiModel: Thread = {
  label: "OSI Model",
  subject: "CN",
  mode: "ask",
  placeholder: "Ask anything about Computer Networks...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Yesterday · Computer Networks",
  blocks: [
    { from: "system", text: "Yesterday · Computer Networks", variant: "divider" },
    {
      from: "user",
      bubbles: [
        {
          type: "mention",
          tokens: [{ value: "@cn", label: "@CN", variant: "blue" }],
          text: "@cn Explain the 7 layers of the OSI model with an example for each.",
        },
      ],
      time: "2026-09-03T10:05:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### The 7 layers, bottom to top

| # | Layer | Example |
|---|---|---|
| 7 | Application | HTTP, DNS |
| 6 | Presentation | TLS, JPEG |
| 5 | Session | NetBIOS, RPC |
| 4 | Transport | TCP, UDP |
| 3 | Network | IP, ICMP |
| 2 | Data Link | Ethernet, MAC |
| 1 | Physical | Cables, hubs |

Mnemonic: **All People Seem To Need Data Processing**.`,
        },
        {
          type: "image",
          src: "/samples/osi-model.svg",
          alt: "Diagram of the 7 OSI layers",
          label: "OSI 7-layer diagram",
        },
        {
          type: "pdf",
          title: "CN Slides: OSI & TCP/IP",
          subtitle: "Course Slides · 24 pages",
          file: "/samples/cn-slides-tcp-udp.pdf",
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "CN Lecture 02.pdf", status: "complete", duration: "38ms" },
        { name: "search", target: "CN textbook · OSI model", status: "complete", duration: "54ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-09-03T10:05:11",
      footer: "PESDac · CN",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "quiz",
          md: `### Quick check

Layer 4 segments arrive out of order at the receiver. Which protocol feature
fixes the order, and at which layer does it live?`,
        },
      ],
      time: "2026-09-03T10:06:02",
    },
  ],
};

const subnetting: Thread = {
  label: "IP Addressing & Subnetting",
  subject: "CN",
  mode: "deep",
  placeholder: "Ask for a deep, step-by-step explanation...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Textbook", description: "PESDac knowledge source" },
  ],
  divider: "Monday · Computer Networks",
  blocks: [
    { from: "system", text: "Monday · Computer Networks", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Subnet 192.168.1.0/24 into 4 equal subnets. Show the ranges." },
      ],
      time: "2026-09-01T18:20:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### /24 into 4 subnets → borrow 2 bits → /26

Each /26 holds 62 usable hosts (64 addresses minus network + broadcast).`,
        },
        {
          type: "code",
          title: "Subnet ranges",
          language: "text",
          code: `192.168.1.0/26    .1  - .62    broadcast .63
192.168.1.64/26   .65 - .126   broadcast .127
192.168.1.128/26  .129 - .190  broadcast .191
192.168.1.192/26  .193 - .254  broadcast .255`,
        },
        {
          type: "quiz",
          md: `### Your turn

How many usable hosts does 10.0.0.0/22 give you? Show the working.`,
        },
      ],
      toolCalls: [
        { name: "search", target: "CN textbook · subnetting", status: "complete", duration: "61ms" },
      ],
      time: "2026-09-01T18:20:19",
      footer: "PESDac · CN",
    },
  ],
};

const routing: Thread = {
  label: "Routing Protocols",
  subject: "CN",
  mode: "ask",
  placeholder: "Ask anything about Computer Networks...",
  composerReferenceItems: [
    { label: "Course Slides", description: "PESDac course material" },
    { label: "Lecture Recordings", description: "PESDac knowledge source" },
  ],
  divider: "Last week · Computer Networks",
  blocks: [
    { from: "system", text: "Last week · Computer Networks", variant: "divider" },
    {
      from: "user",
      bubbles: [
        { type: "text", text: "Compare RIP, OSPF and BGP for a 4-mark question." },
      ],
      time: "2026-08-28T09:12:00",
    },
    {
      from: "assistant",
      bubbles: [
        {
          type: "markdown",
          md: `### RIP vs OSPF vs BGP

| Feature | RIP | OSPF | BGP |
|---|---|---|---|
| Type | Distance vector | Link state | Path vector |
| Metric | Hop count (max 15) | Cost | AS path policy |
| Scope | Small networks | Single AS | Between ASes |
| Convergence | Slow | Fast | Slow, policy-driven |`,
        },
      ],
      toolCalls: [
        { name: "retrieve", target: "CN Lecture 11.pdf", status: "complete", duration: "47ms" },
        { name: "retrieve", target: "CN lecture recording · Routing", status: "complete", duration: "88ms" },
      ],
      toolCallsExpanded: true,
      toolCallsAfter: 0,
      time: "2026-08-28T09:12:13",
      footer: "PESDac · CN",
    },
    {
      from: "assistant",
      bubbles: [
        { type: "text", text: "Saved as a one-page revision sheet." },
        { type: "artifactCard", artifactId: "artifact-cn-routing" },
      ],
      time: "2026-08-28T09:13:01",
    },
  ],
  artifact: {
    id: "artifact-cn-routing",
    title: "CN Revision Sheet: Routing Protocols",
    subtitle: "Study note · Generated from Course Slides & Lecture Recordings",
    markdown: `## RIP vs OSPF vs BGP

**RIP** — distance vector, hop count, max 15 hops, slow convergence.
Good for tiny networks only.

**OSPF** — link state, Dijkstra cost, fast convergence, single AS.
Areas keep large networks scalable.

**BGP** — path vector between autonomous systems, policy-based.
The protocol that runs the internet.

### 4-mark answer plan
1. Classify each protocol (1 mark).
2. Compare metric + scope (2 marks).
3. Convergence example: link failure recovery (1 mark).`,
  },
};

export const cnThreads: Thread[] = [tcpVsUdp, osiModel, subnetting, routing];
