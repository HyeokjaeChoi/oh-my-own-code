var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-9rqn6x4v.js
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __defProp2, __returnValue, __export2;
var init_contract_9rqn6x4v = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-9rqn6x4v.js"() {
    __defProp2 = Object.defineProperty;
    __returnValue = (v) => v;
    __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, {
          get: all[name],
          enumerable: true,
          configurable: true,
          set: __exportSetter.bind(all, name)
        });
    };
  }
});

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-frbwqjmf.js
function make7(connect) {
  let current;
  const capacity = 4096;
  function stop(connection) {
    connection.connected = void 0;
    connection.controller.abort();
    if (current === connection)
      current = void 0;
  }
  async function run(connection) {
    let iterator;
    let completion = {};
    try {
      if (connection.controller.signal.aborted)
        return;
      iterator = connect(connection.controller.signal, () => {
        connection.subscribers.forEach((subscriber) => subscriber.activity?.());
      })[Symbol.asyncIterator]();
      while (!connection.controller.signal.aborted) {
        const item = await iterator.next();
        if (item.done || connection.controller.signal.aborted)
          break;
        if (item.value.type === "server.connected")
          connection.connected = item.value;
        connection.subscribers.forEach((subscriber) => subscriber.push(item.value));
      }
    } catch (error) {
      completion = { error };
    } finally {
      stop(connection);
      try {
        await iterator?.return?.();
      } catch (error) {
        if (!("error" in completion))
          completion = { error };
      }
      connection.subscribers.forEach((subscriber) => subscriber.finish(completion));
    }
  }
  return {
    subscribe(options) {
      return {
        [Symbol.asyncIterator]() {
          const pending = [];
          const queued = [];
          let started = false;
          let completion;
          let connection;
          function finish(result, discard = true) {
            completion = result;
            if (discard)
              queued.length = 0;
            options?.signal?.removeEventListener("abort", abort);
            if (connection?.subscribers.delete(subscriber) && !connection.subscribers.size)
              stop(connection);
            pending.splice(0).forEach((request) => {
              if ("error" in result)
                request.reject(result.error);
              else
                request.resolve({ done: true, value: void 0 });
            });
          }
          function abort() {
            finish({});
          }
          const subscriber = {
            activity: options?.onActivity,
            finish(result) {
              finish(result, false);
            },
            push(value) {
              if (completion)
                return;
              const request = pending.shift();
              if (request) {
                request.resolve({ done: false, value });
                return;
              }
              if (queued.length === capacity) {
                finish({ error: new Error(`Event subscriber exceeded its ${capacity}-event capacity`) });
                return;
              }
              queued.push(value);
            }
          };
          function start() {
            if (completion)
              return;
            const fresh = !current;
            connection = current ?? {
              controller: new AbortController(),
              subscribers: /* @__PURE__ */ new Set()
            };
            current = connection;
            connection.subscribers.add(subscriber);
            if (connection.connected)
              subscriber.push(connection.connected);
            if (fresh)
              run(connection);
          }
          return {
            next() {
              const value = queued.shift();
              if (value)
                return Promise.resolve({ done: false, value });
              if (completion) {
                if ("error" in completion)
                  return Promise.reject(completion.error);
                return Promise.resolve({ done: true, value: void 0 });
              }
              if (options?.signal?.aborted) {
                abort();
                return Promise.resolve({ done: true, value: void 0 });
              }
              const request = Promise.withResolvers();
              pending.push(request);
              if (!started) {
                started = true;
                options?.signal?.addEventListener("abort", abort, { once: true });
                start();
              }
              return request.promise;
            },
            return() {
              finish({});
              return Promise.resolve({ done: true, value: void 0 });
            }
          };
        }
      };
    }
  };
}
var exports_shared_events;
var init_contract_frbwqjmf = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-frbwqjmf.js"() {
    init_contract_9rqn6x4v();
    exports_shared_events = {};
    __export2(exports_shared_events, {
      SharedEvents: () => exports_shared_events,
      make: () => make7
    });
  }
});

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-nwcpakzx.js
var ClientError3;
var init_contract_nwcpakzx = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-nwcpakzx.js"() {
    ClientError3 = class extends Error {
      reason;
      name = "ClientError";
      constructor(reason, options) {
        const detail = options?.detail ?? (options?.cause instanceof Error ? options.cause.message : void 0);
        super(detail ? `${reason}: ${detail}` : reason, options);
        this.reason = reason;
      }
    };
  }
});

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js
function make6(options) {
  const fetch2 = options.fetch ?? globalThis.fetch;
  const prepare = (descriptor, requestOptions) => {
    const baseUrl = new URL(options.baseUrl);
    if (!baseUrl.pathname.endsWith("/"))
      baseUrl.pathname += "/";
    const url = new URL(descriptor.path.slice(1), baseUrl);
    for (const [key2, value] of Object.entries(descriptor.query ?? {}))
      appendQuery(url.searchParams, key2, value);
    const headers = new Headers(options.headers);
    for (const [key2, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== void 0 && value !== null)
        headers.set(key2, String(value));
    }
    for (const [key2, value] of new Headers(requestOptions?.headers))
      headers.set(key2, value);
    if (descriptor.body !== void 0 && !headers.has("content-type"))
      headers.set("content-type", descriptor.binaryBody ? "application/octet-stream" : "application/json");
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === void 0 ? void 0 : descriptor.binaryBody ? descriptor.body : JSON.stringify(descriptor.body)
      }
    };
  };
  const execute = async (descriptor, requestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions);
      return await fetch2(prepared.url, prepared.init);
    } catch (cause) {
      throw new ClientError3("Transport", { cause });
    }
  };
  const responseError = async (response, descriptor) => {
    if (descriptor.declaredStatuses.includes(response.status))
      throw declared(await json(response));
    try {
      await response.body?.cancel();
    } catch {
    }
    throw new ClientError3("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) });
  };
  const request = async (descriptor, requestOptions) => {
    const response = await execute(descriptor, requestOptions);
    if (response.status !== descriptor.successStatus)
      return responseError(response, descriptor);
    if (descriptor.binary)
      return new Uint8Array(await response.arrayBuffer());
    if (descriptor.empty) {
      try {
        await response.body?.cancel();
      } catch {
      }
      return;
    }
    return await json(response);
  };
  const sse = (descriptor, requestOptions) => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions);
      if (response.status !== descriptor.successStatus)
        await responseError(response, descriptor);
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel();
        } catch {
        }
        throw new ClientError3("UnsupportedContentType", { detail: response.headers.get("content-type") });
      }
      if (response.body === null)
        throw new ClientError3("MalformedResponse");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          let next;
          try {
            next = await reader.read();
          } catch (cause) {
            throw new ClientError3("Transport", { cause });
          }
          if (!next.done)
            requestOptions?.onActivity?.();
          buffer += decoder.decode(next.value, { stream: !next.done });
          if (buffer.length > maxSseEventBytes)
            throw new ClientError3("SseEventTooLarge");
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r");
          if (trailingCarriageReturn)
            buffer = buffer.slice(0, -1);
          buffer = buffer.replaceAll(`\r
`, `
`).replaceAll("\r", `
`);
          if (trailingCarriageReturn)
            buffer += "\r";
          if (next.done && buffer !== "")
            buffer += `

`;
          let boundary = buffer.indexOf(`

`);
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split(`
`).flatMap((line) => line.startsWith("data:") ? [line.slice(5).trimStart()] : []).join(`
`);
            if (data !== "") {
              try {
                yield JSON.parse(data);
              } catch (cause) {
                throw new ClientError3("MalformedResponse", { cause });
              }
            }
            boundary = buffer.indexOf(`

`);
          }
          if (next.done)
            return;
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
        }
        reader.releaseLock();
      }
    }
  });
  return {
    server: {
      info: (requestOptions) => request({ method: "GET", path: `/api/info`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions),
      pair: (requestOptions) => request({ method: "POST", path: `/api/pair`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions),
      connect: (input, requestOptions) => request({
        method: "GET",
        path: `/auth/connect/${encodeURIComponent(input.code)}`,
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions)
    },
    location: {
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/location`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      reload: (requestOptions) => request({
        method: "POST",
        path: `/api/location/reload`,
        successStatus: 204,
        declaredStatuses: [400, 401, 503],
        empty: true
      }, requestOptions)
    },
    agent: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/agent`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/agent/${encodeURIComponent(input.agentID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    plugin: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/plugin`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      check: (input, requestOptions) => request({
        method: "POST",
        path: `/api/plugin/check`,
        query: { location: input?.["location"] },
        body: { target: input?.["target"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      update: (input, requestOptions) => request({
        method: "POST",
        path: `/api/plugin/update`,
        query: { location: input["location"] },
        body: { targets: input["targets"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 503],
        empty: true
      }, requestOptions)
    },
    session: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session`,
        query: {
          limit: input?.["limit"],
          order: input?.["order"],
          search: input?.["search"],
          parentID: input?.["parentID"],
          directory: input?.["directory"],
          project: input?.["project"],
          subpath: input?.["subpath"],
          cursor: input?.["cursor"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      stats: (input, requestOptions) => request({
        method: "GET",
        path: `/api/experimental/session/stats`,
        query: {
          from: input?.["from"],
          to: input?.["to"],
          project: input?.["project"],
          timezone: input?.["timezone"],
          tools: input?.["tools"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions).then((value) => value.data),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session`,
        body: {
          id: input?.["id"],
          title: input?.["title"],
          agent: input?.["agent"],
          model: input?.["model"],
          location: input?.["location"],
          metadata: input?.["metadata"],
          permissions: input?.["permissions"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions).then((value) => value.data),
      import: (input, requestOptions) => request({
        method: "POST",
        path: `/api/experimental/session/import`,
        body: { info: input["info"], messages: input["messages"], location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      export: (input, requestOptions) => request({
        method: "GET",
        path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/export`,
        query: { sanitize: input["sanitize"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions).then((value) => value.data),
      active: (requestOptions) => request({
        method: "GET",
        path: `/api/session/active`,
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions).then((value) => value.data),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/session/${encodeURIComponent(input.sessionID)}`,
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      fork: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/fork`,
        body: { before: input["before"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      switchAgent: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
        body: { agent: input["agent"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      switchModel: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
        body: { model: input["model"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      update: (input, requestOptions) => request({
        method: "PATCH",
        path: `/api/session/${encodeURIComponent(input.sessionID)}`,
        body: { title: input["title"], metadata: input["metadata"], permissions: input["permissions"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      move: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/move`,
        body: { directory: input["directory"], delivery: input["delivery"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      prompt: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
        body: {
          id: input["id"],
          text: input["text"],
          files: input["files"],
          agents: input["agents"],
          skills: input["skills"],
          metadata: input["metadata"],
          delivery: input["delivery"],
          resume: input["resume"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      command: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/command`,
        body: {
          name: input["name"],
          text: input["text"],
          files: input["files"],
          agents: input["agents"],
          skills: input["skills"],
          delivery: input["delivery"]
        },
        successStatus: 204,
        declaredStatuses: [400, 401, 404, 500],
        empty: true
      }, requestOptions),
      skill: (input, requestOptions) => request({
        method: "POST",
        path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/skill`,
        body: { id: input["id"], resume: input["resume"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      synthetic: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/synthetic`,
        body: {
          id: input["id"],
          text: input["text"],
          description: input["description"],
          metadata: input["metadata"],
          delivery: input["delivery"],
          resume: input["resume"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      shell: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/shell`,
        body: { id: input["id"], command: input["command"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      compact: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
        body: { id: input["id"], delivery: input["delivery"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      wait: (input, requestOptions) => request({
        method: "POST",
        path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/wait`,
        successStatus: 204,
        declaredStatuses: [400, 401, 404, 503],
        empty: true
      }, requestOptions),
      revert: {
        stage: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
          body: { messageID: input["messageID"], files: input["files"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 409, 500],
          empty: false
        }, requestOptions).then((value) => value.data),
        clear: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/revert`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409, 500],
          empty: true
        }, requestOptions),
        commit: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions)
      },
      context: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions).then((value) => value.data),
      diff: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/diff`,
        query: { from: input["from"], to: input["to"], context: input["context"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions).then((value) => value.data),
      inbox: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        update: (input, requestOptions) => request({
          method: "PATCH",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
          body: { delivery: input["delivery"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions)
      },
      instructions: {
        entry: {
          list: (input, requestOptions) => request({
            method: "GET",
            path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries`,
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false
          }, requestOptions).then((value) => value.data),
          put: (input, requestOptions) => request({
            method: "PUT",
            path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
            body: { value: input["value"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404, 413],
            empty: true
          }, requestOptions),
          remove: (input, requestOptions) => request({
            method: "DELETE",
            path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true
          }, requestOptions)
        }
      },
      generate: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/generate`,
        body: { prompt: input["prompt"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions).then((value) => value.data),
      log: (input, requestOptions) => sse({
        method: "GET",
        path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/log`,
        query: { after: input["after"], follow: input["follow"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      interrupt: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
        query: { resume: input["resume"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      background: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/background`,
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      message: {
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data)
      },
      form: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        create: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
          body: { id: input["id"], title: input["title"], metadata: input["metadata"], fields: input["fields"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 409],
          empty: false
        }, requestOptions).then((value) => value.data),
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        reply: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}/reply`,
          body: { answer: input["answer"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions)
      },
      environment: (input, requestOptions) => request({
        method: "PUT",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/environment`,
        body: { variables: input["variables"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      view: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/view`,
        body: { idle: input["idle"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions)
    },
    message: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
        query: { limit: input["limit"], order: input["order"], cursor: input["cursor"], type: input["type"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions)
    },
    model: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/model`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions),
      default: (input, requestOptions) => request({
        method: "GET",
        path: `/api/model/default`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions)
    },
    generate: {
      text: (input, requestOptions) => request({
        method: "POST",
        path: `/api/experimental/generate`,
        body: { prompt: input["prompt"], model: input["model"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions).then((value) => value.data)
    },
    provider: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/provider`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/provider/${encodeURIComponent(input.providerID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions)
    },
    integration: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/integration`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      wellknown: {
        add: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/integration/wellknown`,
          query: { location: input["location"] },
          body: { url: input["url"] },
          successStatus: 204,
          declaredStatuses: [400, 401],
          empty: true
        }, requestOptions)
      },
      connect: {
        key: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
          query: { location: input["location"] },
          body: { key: input["key"], answer: input["answer"], label: input["label"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions)
      },
      oauth: {
        connect: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
          query: { location: input["location"] },
          body: { methodID: input["methodID"], answer: input["answer"], label: input["label"] },
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions),
        status: (input, requestOptions) => request({
          method: "GET",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions),
        complete: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}/complete`,
          query: { location: input["location"] },
          body: { code: input["code"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401],
          empty: true
        }, requestOptions)
      },
      command: {
        connect: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command`,
          query: { location: input["location"] },
          body: { methodID: input["methodID"], label: input["label"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions),
        status: (input, requestOptions) => request({
          method: "GET",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401],
          empty: true
        }, requestOptions)
      }
    },
    mcp: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/mcp`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      add: (input, requestOptions) => request({
        method: "PUT",
        path: `/api/experimental/mcp/${encodeURIComponent(input.server)}`,
        query: { location: input["location"] },
        body: { config: input["config"] },
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/experimental/mcp/${encodeURIComponent(input.server)}`,
        query: { location: input["location"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      connect: (input, requestOptions) => request({
        method: "POST",
        path: `/api/experimental/mcp/${encodeURIComponent(input.server)}/connect`,
        query: { location: input["location"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      disconnect: (input, requestOptions) => request({
        method: "POST",
        path: `/api/experimental/mcp/${encodeURIComponent(input.server)}/disconnect`,
        query: { location: input["location"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      resource: {
        catalog: (input, requestOptions) => request({
          method: "GET",
          path: `/api/mcp/resource`,
          query: { location: input?.["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions)
      }
    },
    credential: {
      update: (input, requestOptions) => request({
        method: "PATCH",
        path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
        body: { label: input["label"] },
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions),
      activate: (input, requestOptions) => request({
        method: "POST",
        path: `/api/credential/${encodeURIComponent(input.credentialID)}/activate`,
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions)
    },
    project: {
      list: (requestOptions) => request({ method: "GET", path: `/api/project`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions),
      update: (input, requestOptions) => request({
        method: "PATCH",
        path: `/api/project/${encodeURIComponent(input.projectID)}`,
        body: {
          canonical: input["canonical"],
          name: input["name"],
          icon: input["icon"],
          commands: input["commands"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    form: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/form`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions)
    },
    permission: {
      request: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/permission/request`,
          query: { location: input?.["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions)
      },
      saved: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/permission/saved`,
          query: { projectID: input?.["projectID"] },
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions).then((value) => value.data),
        remove: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
          successStatus: 204,
          declaredStatuses: [400, 401],
          empty: true
        }, requestOptions)
      },
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
        body: {
          id: input["id"],
          action: input["action"],
          resources: input["resources"],
          save: input["save"],
          metadata: input["metadata"],
          source: input["source"],
          agent: input["agent"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      reply: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
        body: { decision: input["decision"], message: input["message"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions)
    },
    file: {
      read: (input, requestOptions) => request({
        method: "GET",
        path: `/api/fs/read/${encodePath(input.path)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false,
        binary: true
      }, requestOptions),
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/fs/list`,
        query: { location: input?.["location"], path: input?.["path"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      find: (input, requestOptions) => request({
        method: "GET",
        path: `/api/fs/find`,
        query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      write: (input, requestOptions) => request({
        method: "POST",
        path: `/api/experimental/fs/write`,
        query: { location: input["location"], path: input["path"] },
        body: input["payload"],
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false,
        binaryBody: true
      }, requestOptions)
    },
    command: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/command`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions)
    },
    skill: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/skill`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions)
    },
    rpc: {
      call: (input, requestOptions) => request({
        method: "POST",
        path: `/api/rpc/${encodeURIComponent(input.rpcID)}/${encodeURIComponent(input.method)}`,
        query: { location: input["location"] },
        body: { input: input["input"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 500],
        empty: false
      }, requestOptions)
    },
    event: {
      subscribe: (requestOptions) => sse({ method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions)
    },
    pty: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/pty`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/pty`,
        query: { location: input?.["location"] },
        body: {
          command: input?.["command"],
          args: input?.["args"],
          cwd: input?.["cwd"],
          title: input?.["title"],
          env: input?.["env"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      update: (input, requestOptions) => request({
        method: "PUT",
        path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
        query: { location: input["location"] },
        body: { title: input["title"], size: input["size"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
        query: { location: input["location"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      connect: {
        token: (input, requestOptions) => request({
          method: "POST",
          path: `/api/pty/${encodeURIComponent(input.ptyID)}/connect-token`,
          query: { location: input["location"] },
          headers: { "x-opencode-ticket": input["x-opencode-ticket"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404],
          empty: false
        }, requestOptions)
      }
    },
    experimental: {
      persistentPty: {
        read: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal/read`,
          query: { lines: input["lines"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal`,
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        create: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal`,
          body: {
            command: input["command"],
            args: input["args"],
            cwd: input["cwd"],
            title: input["title"],
            env: input["env"],
            size: input["size"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        shutdown: (requestOptions) => request({
          method: "POST",
          path: `/api/experimental/persistent-pty/shutdown`,
          successStatus: 204,
          declaredStatuses: [400, 401, 503],
          empty: true
        }, requestOptions),
        handoff: (requestOptions) => request({
          method: "POST",
          path: `/api/experimental/persistent-pty/handoff`,
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions),
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        update: (input, requestOptions) => request({
          method: "PUT",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
          body: { attachmentID: input["attachmentID"], size: input["size"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        snapshot: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/snapshot`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        remove: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 503],
          empty: true
        }, requestOptions),
        connectToken: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/connect-token`,
          headers: { "x-opencode-ticket": input["x-opencode-ticket"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data)
      }
    },
    shell: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/shell`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/shell`,
        query: { location: input["location"] },
        body: {
          command: input["command"],
          cwd: input["cwd"],
          timeout: input["timeout"],
          metadata: input["metadata"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/shell/${encodeURIComponent(input.id)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      output: (input, requestOptions) => request({
        method: "GET",
        path: `/api/shell/${encodeURIComponent(input.id)}/output`,
        query: { location: input["location"], cursor: input["cursor"], limit: input["limit"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/shell/${encodeURIComponent(input.id)}`,
        query: { location: input["location"] },
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions)
    },
    reference: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/reference`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions)
    },
    worktree: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/worktree`,
        query: { projectID: input["projectID"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/worktree`,
        body: {
          projectID: input["projectID"],
          from: input["from"],
          branch: input["branch"],
          directory: input["directory"],
          name: input["name"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/worktree`,
        body: { projectID: input["projectID"], directory: input["directory"], force: input["force"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      refresh: (input, requestOptions) => request({
        method: "POST",
        path: `/api/worktree/refresh`,
        body: { projectID: input["projectID"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions)
    },
    vcs: {
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      base: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs/base`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions),
      status: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs/status`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      branch: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/vcs/branch`,
          query: { location: input?.["location"], search: input?.["search"], limit: input?.["limit"] },
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions)
      },
      diff: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs/diff`,
        query: { location: input["location"], mode: input["mode"], base: input["base"], context: input["context"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions)
    },
    debug: {
      location: {
        list: (requestOptions) => request({
          method: "GET",
          path: `/api/debug/location`,
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions),
        evict: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/debug/location`,
          query: { location: input?.["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401],
          empty: true
        }, requestOptions)
      }
    },
    migration: {
      v1: {
        status: (requestOptions) => request({
          method: "GET",
          path: `/api/experimental/migration/v1`,
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions)
      }
    },
    websearch: {
      providers: (input, requestOptions) => request({
        method: "GET",
        path: `/api/websearch/provider`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions),
      query: (input, requestOptions) => request({
        method: "POST",
        path: `/api/websearch`,
        query: { location: input["location"] },
        body: { query: input["query"], providerID: input["providerID"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 503],
        empty: false
      }, requestOptions)
    },
    config: {
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/config`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      shells: (requestOptions) => request({ method: "GET", path: `/api/config/shell`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions),
      update: (input, requestOptions) => request({
        method: "PATCH",
        path: `/api/experimental/config`,
        body: { shell: input["shell"] },
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions)
    }
  };
}
function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}
function appendQuery(params, key2, value) {
  if (value === void 0)
    return;
  if (value === null) {
    params.append(key2, "null");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      appendQuery(params, key2, item);
    return;
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value))
      appendQuery(params, `${key2}[${child}]`, item);
    return;
  }
  params.append(key2, String(value));
}
async function json(response) {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel();
    } catch {
    }
    throw new ClientError3("UnsupportedContentType", { detail: response.headers.get("content-type") });
  }
  let text;
  try {
    text = await response.text();
  } catch (cause) {
    throw new ClientError3("Transport", { cause });
  }
  if (text === "")
    throw new ClientError3("MalformedResponse");
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ClientError3("MalformedResponse", { cause });
  }
}
function declared(body) {
  const error = Object.assign(new Error(body.message ?? body.data?.message), body);
  if (body._tag)
    error.name = body._tag;
  return error;
}
function isContentType(response, expected) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected;
}
var exports_client4, maxSseEventBytes;
var init_contract_n8g24fq8 = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js"() {
    init_contract_nwcpakzx();
    init_contract_9rqn6x4v();
    exports_client4 = {};
    __export2(exports_client4, {
      make: () => make6
    });
    maxSseEventBytes = 16 * 1024 * 1024;
  }
});

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-4tveyqeh.js
var isInvalidRequestError2, isUnauthorizedError2, isServiceUnavailableError2, isAgentNotFoundError2, isInvalidCursorError2, isSessionNotFoundError2, isConflictError2, isUnknownError2, isMessageNotFoundError2, isCommandNotFoundError2, isCommandExecutionError2, isSkillNotFoundError2, isSessionBusyError2, isInstructionEntryValueTooLargeError2, isFormNotFoundError2, isFormInvalidAnswerError2, isFormAlreadySettledError2, isProviderNotFoundError2, isIntegrationNotFoundError2, isIntegrationAttemptNotFoundError2, isIntegrationMethodNotFoundError2, isMcpServerNotFoundError2, isProjectNotFoundError2, isPermissionNotFoundError2, isFileNotFoundError2, isRpcError2, isRpcInternalError2, isPtyNotFoundError2, isForbiddenError2, isShellNotFoundError2, isWorktreeError2;
var init_contract_4tveyqeh = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-4tveyqeh.js"() {
    isInvalidRequestError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError";
    isUnauthorizedError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError";
    isServiceUnavailableError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError";
    isAgentNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "AgentNotFoundError";
    isInvalidCursorError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError";
    isSessionNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError";
    isConflictError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError";
    isUnknownError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError";
    isMessageNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError";
    isCommandNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandNotFoundError";
    isCommandExecutionError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandExecutionError";
    isSkillNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SkillNotFoundError";
    isSessionBusyError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionBusyError";
    isInstructionEntryValueTooLargeError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InstructionEntryValueTooLargeError";
    isFormNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormNotFoundError";
    isFormInvalidAnswerError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormInvalidAnswerError";
    isFormAlreadySettledError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormAlreadySettledError";
    isProviderNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError";
    isIntegrationNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationNotFoundError";
    isIntegrationAttemptNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationAttemptNotFoundError";
    isIntegrationMethodNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationMethodNotFoundError";
    isMcpServerNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "McpServerNotFoundError";
    isProjectNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProjectNotFoundError";
    isPermissionNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError";
    isFileNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FileNotFoundError";
    isRpcError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "RpcError";
    isRpcInternalError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "RpcInternalError";
    isPtyNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError";
    isForbiddenError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ForbiddenError";
    isShellNotFoundError2 = (value) => typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ShellNotFoundError";
    isWorktreeError2 = (value) => typeof value === "object" && value !== null && "name" in value && value["name"] === "WorktreeError";
  }
});

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-1tbj6z39.js
function makeRpc2(raw, events) {
  return (definition) => {
    const subscribe = (name, options) => {
      if (!Object.hasOwn(definition.events, name))
        throw new Error(`Unknown RPC event: ${definition.id}.${name}`);
      const type = eventType(definition, name);
      return {
        [Symbol.asyncIterator]() {
          const controller = new AbortController();
          const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
          const iterator = (async function* () {
            try {
              for await (const published of events.subscribe({ signal })) {
                if (signal.aborted)
                  return;
                if (published.type !== type)
                  continue;
                yield published;
              }
            } catch (error) {
              if (!signal.aborted)
                throw error;
            } finally {
              controller.abort();
            }
          })();
          return {
            next: () => iterator.next(),
            return: () => {
              controller.abort();
              return iterator.return();
            }
          };
        }
      };
    };
    return Object.assign(Object.fromEntries(Object.keys(definition.methods).map((name) => [
      name,
      async (input, options) => {
        try {
          const result = await raw.rpc.call({
            rpcID: definition.id,
            method: name,
            input,
            location: options?.location
          }, { signal: options?.signal, headers: options?.headers });
          return result.output;
        } catch (error) {
          if (!isRpcError2(error) && !isRpcInternalError2(error))
            throw error;
          throw error.data === void 0 ? { type: error.type, message: error.message } : { type: error.type, message: error.message, data: error.data };
        }
      }
    ])), {
      events: {
        subscribe,
        on: (name, handler, options) => {
          const controller = new AbortController();
          const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
          const source = subscribe(name, { signal });
          (async () => {
            for await (const event of source)
              await handler(event);
          })().catch((error) => console.error(error));
          return () => controller.abort();
        }
      }
    });
  };
}
function eventType(definition, name) {
  return `rpc.${definition.id}.${name}`;
}
var init_contract_1tbj6z39 = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-1tbj6z39.js"() {
    init_contract_4tveyqeh();
  }
});

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-hg4r8g3y.js
function make5(options) {
  const raw = make6(options);
  const events = make7((signal, onActivity) => raw.event.subscribe({ signal, onActivity }));
  return {
    ...raw,
    rpc: Object.assign(makeRpc2(raw, events), raw.rpc),
    event: events
  };
}
var exports_client3;
var init_contract_hg4r8g3y = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/chunks/contract-hg4r8g3y.js"() {
    init_contract_frbwqjmf();
    init_contract_n8g24fq8();
    init_contract_1tbj6z39();
    init_contract_9rqn6x4v();
    exports_client3 = {};
    __export2(exports_client3, {
      OpenCode: () => exports_client3,
      make: () => make5
    });
  }
});

// node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/promise/index.js
var promise_exports = {};
__export(promise_exports, {
  ClientError: () => ClientError3,
  OpenCode: () => exports_client3,
  isAgentNotFoundError: () => isAgentNotFoundError2,
  isCommandExecutionError: () => isCommandExecutionError2,
  isCommandNotFoundError: () => isCommandNotFoundError2,
  isConflictError: () => isConflictError2,
  isFileNotFoundError: () => isFileNotFoundError2,
  isForbiddenError: () => isForbiddenError2,
  isFormAlreadySettledError: () => isFormAlreadySettledError2,
  isFormInvalidAnswerError: () => isFormInvalidAnswerError2,
  isFormNotFoundError: () => isFormNotFoundError2,
  isInstructionEntryValueTooLargeError: () => isInstructionEntryValueTooLargeError2,
  isIntegrationAttemptNotFoundError: () => isIntegrationAttemptNotFoundError2,
  isIntegrationMethodNotFoundError: () => isIntegrationMethodNotFoundError2,
  isIntegrationNotFoundError: () => isIntegrationNotFoundError2,
  isInvalidCursorError: () => isInvalidCursorError2,
  isInvalidRequestError: () => isInvalidRequestError2,
  isMcpServerNotFoundError: () => isMcpServerNotFoundError2,
  isMessageNotFoundError: () => isMessageNotFoundError2,
  isPermissionNotFoundError: () => isPermissionNotFoundError2,
  isProjectNotFoundError: () => isProjectNotFoundError2,
  isProviderNotFoundError: () => isProviderNotFoundError2,
  isPtyNotFoundError: () => isPtyNotFoundError2,
  isRpcError: () => isRpcError2,
  isRpcInternalError: () => isRpcInternalError2,
  isServiceUnavailableError: () => isServiceUnavailableError2,
  isSessionBusyError: () => isSessionBusyError2,
  isSessionNotFoundError: () => isSessionNotFoundError2,
  isShellNotFoundError: () => isShellNotFoundError2,
  isSkillNotFoundError: () => isSkillNotFoundError2,
  isUnauthorizedError: () => isUnauthorizedError2,
  isUnknownError: () => isUnknownError2,
  isWorktreeError: () => isWorktreeError2
});
var init_promise = __esm({
  "node_modules/.pnpm/@opencode+client@2.0.18_effect@4.0.0-rc.112/node_modules/@opencode/client/dist/promise/index.js"() {
    init_contract_hg4r8g3y();
    init_contract_1tbj6z39();
    init_contract_n8g24fq8();
    init_contract_4tveyqeh();
    init_contract_nwcpakzx();
    init_contract_frbwqjmf();
  }
});

// apps/desktop-app/src/event-host-protocol.mjs
import { isAbsolute } from "node:path";
function validateHostMessage(message, receiver) {
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(message));
  } catch {
    throw new Error("invalid_ipc");
  }
  if (size > 16384 || !message || !hex(message.nonce))
    throw new Error("invalid_ipc");
  if (receiver === "child") {
    if (message.type === "stop" && closed(message, ["type", "nonce"]))
      return message;
    if (message.type === "observe" && closed(message, ["type", "nonce", "requestId"]) && hex(message.requestId))
      return message;
    const keys2 = [
      "type",
      "nonce",
      "password",
      "port",
      "root",
      "workspace",
      "configPath",
      "namespaceRoot",
      "dataPath",
      "statePath",
      "database",
      "engineVersion",
      "serverVersion"
    ];
    if (message.type !== "init" || !closed(message, keys2) || !hex(message.password) || !Number.isInteger(message.port) || message.port < 0 || message.port > 65535 || message.engineVersion !== "1.4.2" || message.serverVersion !== "2.0.18" || ![
      "root",
      "workspace",
      "configPath",
      "namespaceRoot",
      "dataPath",
      "statePath",
      "database"
    ].every((key2) => absolute(message[key2])))
      throw new Error("invalid_ipc");
  } else if (receiver === "parent") {
    if (!Number.isSafeInteger(message.pid) || message.pid <= 0)
      throw new Error("invalid_ipc");
    if (message.type === "ready") {
      if (!closed(message, [
        "type",
        "nonce",
        "pid",
        "port",
        "engineVersion",
        "serverVersion"
      ]) || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535 || message.engineVersion !== "1.4.2" || message.serverVersion !== "2.0.18")
        throw new Error("invalid_ipc");
    } else if (message.type === "observation") {
      if (!closed(message, [
        "type",
        "nonce",
        "pid",
        "requestId",
        "observerGap",
        "live",
        "allExited"
      ]) || !hex(message.requestId) || typeof message.observerGap !== "boolean" || typeof message.allExited !== "boolean" || !Number.isSafeInteger(message.live) || message.live < 0 || message.live > 1e5 || message.allExited !== (message.live === 0))
        throw new Error("invalid_ipc");
    } else if (message.type === "scope-closed") {
      if (!closed(message, ["type", "nonce", "pid", "observerGap", "live"]) || typeof message.observerGap !== "boolean" || !Number.isSafeInteger(message.live) || message.live < 0 || message.live > 1e5)
        throw new Error("invalid_ipc");
    } else if (message.type !== "hold" || !closed(message, ["type", "nonce", "pid"]))
      throw new Error("invalid_ipc");
  } else throw new Error("invalid_ipc");
  return message;
}
var EVENT_HOST_CONFIG, hex, closed, absolute;
var init_event_host_protocol = __esm({
  "apps/desktop-app/src/event-host-protocol.mjs"() {
    "use strict";
    EVENT_HOST_CONFIG = JSON.stringify({
      plugins: [],
      mcp: {},
      providers: {},
      instructions: [],
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
      update: "disable",
      share: "disabled"
    });
    hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    closed = (object, keys2) => object && typeof object === "object" && !Array.isArray(object) && Object.keys(object).sort().join() === keys2.sort().join();
    absolute = (value) => typeof value === "string" && isAbsolute(value) && !value.includes("\0");
  }
});

// apps/desktop-app/src/event-host-resources.mjs
var event_host_resources_exports = {};
__export(event_host_resources_exports, {
  EVENT_HOST_IDENTITY: () => EVENT_HOST_IDENTITY,
  EVENT_HOST_LIMITS: () => EVENT_HOST_LIMITS,
  EVENT_HOST_MANIFEST_MAX_BYTES: () => EVENT_HOST_MANIFEST_MAX_BYTES,
  assertEventHostTarget: () => assertEventHostTarget,
  assertRealResourceParents: () => assertRealResourceParents,
  eventHostForResources: () => eventHostForResources,
  eventHostInventorySha256: () => eventHostInventorySha256,
  inventoryEventHostTree: () => inventoryEventHostTree,
  readResourceJson: () => readResourceJson,
  resourceFileSha256: () => resourceFileSha256,
  safeResourcePath: () => safeResourcePath,
  verifyEventHostResources: () => verifyEventHostResources,
  verifyLockedEventHostPackages: () => verifyLockedEventHostPackages
});
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute as isAbsolute2, join, relative, resolve, sep } from "node:path";
function assertEventHostTarget(platform, arch) {
  if (platform !== "darwin" || arch !== "arm64")
    fail(`unsupported target ${platform}-${arch}; hold required`);
}
function eventHostForResources(resources, platform, arch) {
  assertEventHostTarget(platform, arch);
  if (typeof resources !== "string" || !isAbsolute2(resources))
    fail("resources must be absolute");
  const root = join(resources, "opencode", "event-host", "darwin-arm64");
  return Object.freeze({
    root,
    enginePath: join(root, "runtime", "bun"),
    hostPath: join(root, "host.mjs"),
    manifestPath: join(root, "manifest.json")
  });
}
function eventHostInventorySha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function safeResourcePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || isAbsolute2(value) || value.split("/").some((p) => !p || p === "." || p === "..") || value.split("/").length > EVENT_HOST_LIMITS.depth)
    fail("invalid relative path");
  return value;
}
async function assertRealResourceParents(path2) {
  path2 = resolve(path2);
  const parts = path2.split(sep).filter(Boolean);
  let current = sep;
  for (const part of parts) {
    current = join(current, part);
    const stat2 = await lstat(current);
    if (!stat2.isDirectory() || stat2.isSymbolicLink())
      fail("symlink or non-directory parent");
  }
}
function unchanged(a, b) {
  return a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mode === b.mode && a.nlink === b.nlink && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
async function resourceFileSha256(path2) {
  const before = await lstat(path2);
  if (!before.isFile() || before.nlink !== 1)
    fail("regular single-link file required");
  const handle = await open(path2, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!unchanged(before, await handle.stat()))
      fail("file changed before read");
    const hash3 = createHash("sha256");
    for await (const bytes of handle.createReadStream({ autoClose: false }))
      hash3.update(bytes);
    if (!unchanged(before, await handle.stat()) || !unchanged(before, await lstat(path2)))
      fail("file changed while hashing");
    return hash3.digest("hex");
  } finally {
    await handle.close();
  }
}
async function readResourceJson(path2, maxBytes = EVENT_HOST_MANIFEST_MAX_BYTES) {
  const before = await lstat(path2);
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes)
    fail("bounded regular JSON file required");
  const handle = await open(path2, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!unchanged(before, await handle.stat()))
      fail("JSON changed before read");
    const data = await handle.readFile();
    if (data.length > maxBytes || !unchanged(before, await handle.stat()) || !unchanged(before, await lstat(path2)))
      fail("JSON changed during read");
    return JSON.parse(data.toString("utf8"));
  } finally {
    await handle.close();
  }
}
async function checkLink(root, path2, target) {
  if (typeof target !== "string" || !target || target.includes("\\") || target.includes("\0") || isAbsolute2(target))
    fail("invalid symlink target");
  const absolute2 = resolve(dirname(join(root, path2)), target);
  if (!contained(root, absolute2)) fail("symlink escape");
  let current = root;
  const parts = relative(root, absolute2).split(sep);
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    const stat2 = await lstat(current);
    if (stat2.isSymbolicLink() || i < parts.length - 1 && !stat2.isDirectory())
      fail("symlink chain or invalid target");
    if (i === parts.length - 1 && (!stat2.isFile() || stat2.nlink !== 1))
      fail("symlink must target contained single-link file");
  }
}
async function inventoryEventHostTree(root, { links = {} } = {}) {
  await assertRealResourceParents(root);
  const entries = [];
  let bytes = 0;
  async function walk(directory, depth) {
    if (depth > EVENT_HOST_LIMITS.depth) fail("depth limit");
    const before = await lstat(directory);
    for (const name of (await readdir(directory)).sort()) {
      const path2 = relative(root, join(directory, name)).split(sep).join("/");
      if (path2 === "manifest.json") continue;
      safeResourcePath(path2);
      if (entries.length >= EVENT_HOST_LIMITS.entries) fail("entry limit");
      const absolute2 = join(root, path2);
      const stat2 = await lstat(absolute2);
      const mode = stat2.mode & 4095;
      if (mode & 3584) fail("special mode rejected");
      if (stat2.isSymbolicLink()) {
        const target = await readlink(absolute2);
        if (!Object.hasOwn(links, path2) || links[path2].target !== target || stat2.nlink !== 1)
          fail("undeclared or changed symlink");
        await checkLink(root, path2, target);
        if (links[path2].target_sha256 && await resourceFileSha256(resolve(dirname(absolute2), target)) !== links[path2].target_sha256)
          fail("symlink target hash drift");
        entries.push({ path: path2, type: "symlink", mode, nlink: 1, target });
      } else if (stat2.isDirectory()) {
        entries.push({ path: path2, type: "directory", mode });
        await walk(absolute2, depth + 1);
      } else if (stat2.isFile()) {
        if (stat2.nlink !== 1) fail("hardlink rejected");
        bytes += stat2.size;
        if (bytes > EVENT_HOST_LIMITS.bytes) fail("byte limit");
        entries.push({
          path: path2,
          type: "file",
          mode,
          nlink: 1,
          size: stat2.size,
          sha256: await resourceFileSha256(absolute2)
        });
      } else fail("unknown file type");
      if (!unchanged(stat2, await lstat(absolute2)))
        fail("entry changed during inventory");
    }
    if (!unchanged(before, await lstat(directory)))
      fail("directory changed during inventory");
  }
  await walk(root, 0);
  for (const path2 of Object.keys(links))
    if (!entries.some((e) => e.path === path2 && e.type === "symlink"))
      fail("missing declared symlink");
  return entries.sort(
    (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
}
function validateManifest(manifest) {
  if (!keys(manifest, [...Object.keys(EVENT_HOST_IDENTITY), "entries"]))
    fail("unknown manifest fields");
  for (const [key2, value] of Object.entries(EVENT_HOST_IDENTITY))
    if (manifest[key2] !== value)
      fail(`identity/version/target mismatch: ${key2}`);
  if (!Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > EVENT_HOST_LIMITS.entries)
    fail("entry limit");
  const seen = /* @__PURE__ */ new Set();
  let bytes = 0;
  let previous = "";
  for (const entry of manifest.entries) {
    safeResourcePath(entry.path);
    if (entry.path === "manifest.json" || seen.has(entry.path) || entry.path <= previous)
      fail("duplicate or unordered manifest path");
    seen.add(entry.path);
    previous = entry.path;
    const fields = entry.type === "file" ? ["path", "type", "mode", "nlink", "size", "sha256"] : entry.type === "directory" ? ["path", "type", "mode"] : entry.type === "symlink" ? ["path", "type", "mode", "nlink", "target"] : [];
    if (!fields.length || !keys(entry, fields) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 511)
      fail("unknown or invalid entry");
    if (entry.type !== "directory" && entry.nlink !== 1) fail("nlink drift");
    if (entry.type === "file") {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256))
        fail("invalid file identity");
      bytes += entry.size;
      if (bytes > EVENT_HOST_LIMITS.bytes) fail("byte limit");
    }
  }
  for (const path2 of [
    "runtime/bun",
    "host.mjs",
    "event-host-protocol.mjs",
    "package.json",
    "package-lock.json",
    "node_modules/@opencode/server/package.json",
    "node_modules/@opencode/client/package.json",
    "node_modules/effect/package.json"
  ])
    if (!manifest.entries.some((e) => e.path === path2 && e.type === "file"))
      fail(`missing required asset ${path2}`);
  if (!(manifest.entries.find((e) => e.path === "runtime/bun").mode & 73))
    fail("engine not executable");
}
async function verifyLockedEventHostPackages(root, entries) {
  const pkg = await readResourceJson(join(root, "package.json"));
  const lock = await readResourceJson(join(root, "package-lock.json"));
  const expected = {
    "@opencode/server": "2.0.18",
    "@opencode/client": "2.0.18",
    effect: "4.0.0-rc.112"
  };
  const sorted = (value) => JSON.stringify(Object.entries(value ?? {}).sort());
  if (lock.lockfileVersion !== 3 || !lock.packages || pkg.scripts || lock.packages[""].scripts || sorted(pkg.dependencies) !== sorted(expected) || sorted(lock.packages[""].dependencies) !== sorted(expected))
    fail("runtime package/lock version mismatch");
  const present = /* @__PURE__ */ new Set();
  for (const entry of entries.filter(
    (e) => e.type === "file" && /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package.json$/.test(e.path)
  )) {
    const path2 = entry.path.slice(0, -"/package.json".length);
    const locked = lock.packages[path2];
    const actual = await readResourceJson(join(root, entry.path));
    const name = path2.slice(
      path2.lastIndexOf("node_modules/") + "node_modules/".length
    );
    if (!locked || actual.name !== (locked.name ?? name) || actual.version !== locked.version)
      fail(`unknown/package version drift ${path2}`);
    present.add(path2);
  }
  for (const [path2, item] of Object.entries(lock.packages)) {
    if (!path2) continue;
    safeResourcePath(path2);
    let url;
    try {
      url = new URL(item.resolved);
    } catch {
      fail("invalid locked origin");
    }
    if (!path2.startsWith("node_modules/") || item.link || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(item.version) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity) || url.origin !== "https://registry.npmjs.org" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".tgz"))
      fail("invalid locked identity/origin/integrity");
    const allows = (list, target) => !list || (!list.some((x) => !x.startsWith("!")) || list.includes(target)) && !list.includes(`!${target}`);
    const selected = allows(item.os, "darwin") && allows(item.cpu, "arm64");
    if (selected && !present.has(path2) || !selected && present.has(path2))
      fail(`missing or wrong-target locked package ${path2}`);
  }
}
async function verifyEventHostResources(descriptor, { platform = process.platform, arch = process.arch } = {}) {
  assertEventHostTarget(platform, arch);
  if (!keys(descriptor, ["root", "enginePath", "hostPath", "manifestPath"]) || !isAbsolute2(descriptor.root) || !descriptor.root.endsWith(
    `${sep}opencode${sep}event-host${sep}darwin-arm64`
  ) || descriptor.enginePath !== join(descriptor.root, "runtime/bun") || descriptor.hostPath !== join(descriptor.root, "host.mjs") || descriptor.manifestPath !== join(descriptor.root, "manifest.json"))
    fail("invalid closed descriptor");
  await assertRealResourceParents(descriptor.root);
  const manifest = await readResourceJson(descriptor.manifestPath);
  validateManifest(manifest);
  const links = Object.fromEntries(
    manifest.entries.filter((e) => e.type === "symlink").map((e) => [e.path, { target: e.target }])
  );
  const actual = await inventoryEventHostTree(descriptor.root, { links });
  if (JSON.stringify(actual) !== JSON.stringify(manifest.entries))
    fail("missing/extra/hash/mode/type drift");
  await verifyLockedEventHostPackages(descriptor.root, actual);
  for (const [name, version] of [
    ["@opencode/server", manifest.serverVersion],
    ["@opencode/client", manifest.serverVersion],
    ["effect", manifest.effectVersion]
  ]) {
    const pkg = await readResourceJson(
      join(descriptor.root, "node_modules", name, "package.json")
    );
    if (pkg.name !== name || pkg.version !== version)
      fail("installed package version drift");
  }
  if (JSON.stringify(await inventoryEventHostTree(descriptor.root, { links })) !== JSON.stringify(actual) || JSON.stringify(await readResourceJson(descriptor.manifestPath)) !== JSON.stringify(manifest))
    fail("resource changed during verification");
  return manifest;
}
var EVENT_HOST_MANIFEST_MAX_BYTES, EVENT_HOST_LIMITS, EVENT_HOST_IDENTITY, keys, fail, contained;
var init_event_host_resources = __esm({
  "apps/desktop-app/src/event-host-resources.mjs"() {
    "use strict";
    EVENT_HOST_MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
    EVENT_HOST_LIMITS = Object.freeze({
      entries: 1e5,
      bytes: 2 * 1024 ** 3,
      depth: 64
    });
    EVENT_HOST_IDENTITY = Object.freeze({
      schemaVersion: 1,
      kind: "opencode-event-host",
      platform: "darwin",
      arch: "arm64",
      bunVersion: "1.4.2",
      serverVersion: "2.0.18",
      effectVersion: "4.0.0-rc.112"
    });
    keys = (object, expected) => object && typeof object === "object" && !Array.isArray(object) && Object.keys(object).sort().join() === [...expected].sort().join();
    fail = (message) => {
      throw new Error(`Event host resources: ${message}`);
    };
    contained = (root, path2) => {
      const rel = relative(root, path2);
      return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute2(rel);
    };
  }
});

// apps/desktop-app/src/event-host-supervisor.mjs
var event_host_supervisor_exports = {};
__export(event_host_supervisor_exports, {
  eventHostForResources: () => eventHostForResources,
  startEventHost: () => startEventHost
});
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  lstat as lstat2,
  realpath
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2, relative as relative2, isAbsolute as isAbsolute3 } from "node:path";
function contains(parent, path2) {
  const rel = relative2(parent, path2);
  return !rel || !isAbsolute3(rel) && rel !== ".." && !rel.startsWith("../");
}
function overlaps(a, b) {
  return contains(a, b) || contains(b, a);
}
async function checkedDirectory(path2) {
  const stat2 = await lstat2(path2);
  if (!isAbsolute3(path2) || await realpath(path2) !== path2 || !stat2.isDirectory() || stat2.isSymbolicLink() || stat2.uid !== process.getuid() || stat2.mode & 63)
    throw new Error("storage_denied");
}
async function startEventHost({
  eventHost,
  namespace: namespace2,
  owner: owner2,
  processIdentity: processIdentity2,
  preflight,
  signal,
  port = 0,
  platform = process.platform,
  arch = process.arch,
  spawnProcess = spawn,
  createDirectory = mkdir,
  writeConfig = writeFile,
  removeRoot = rm,
  makeRoot = async () => realpath(await mkdtemp(join2(tmpdir(), "oh-my-own-code-event-host-"))),
  verifyResources,
  makeClient,
  startupTimeoutMs = 2e4,
  stopTimeoutMs = 5e3,
  requestTimeoutMs = 5e3
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("invalid_sidecar_port");
  const aborted = () => {
    if (signal?.aborted) throw new Error("startup_aborted");
  };
  const guard = async () => {
    aborted();
    if (!namespace2 || !owner2 || (await owner2.assertOwned(owner2.getNonce())).state !== "ready")
      throw new Error("owner_unverified");
    if (typeof preflight !== "function" || await preflight() !== true)
      throw new Error("native_startup_unverified");
    aborted();
  };
  await guard();
  const validator = verifyResources ?? (await Promise.resolve().then(() => (init_event_host_resources(), event_host_resources_exports))).verifyEventHostResources;
  await validator(eventHost, { platform, arch });
  aborted();
  const root = await makeRoot();
  const workspace = join2(root, "workspace");
  const nonce = randomBytes(32).toString("hex");
  const password = randomBytes(32).toString("hex");
  let child, exitResult, resolveExit, ready2, resolveReady, stopping = false;
  let spawnIntent = false;
  let uncertain = false, recorded = false, initialized = false, scopeClosed = false;
  let stopPromise2, cleanupDone = false, failureReason, connected = false;
  let ownedIdentity, observationRequest, observationActive = false, pendingHostRequests = 0;
  const exited = new Promise((resolve4) => {
    resolveExit = resolve4;
  });
  const readiness = new Promise((resolve4) => {
    resolveReady = resolve4;
  });
  let wakeFailure;
  const failed = new Promise((resolve4) => {
    wakeFailure = resolve4;
  });
  const fail3 = (reason) => {
    uncertain = true;
    failureReason ??= reason;
    wakeFailure();
    if (connected && !stopping) void stop();
  };
  const bounded = (promise, ms, timeout) => new Promise((resolve4, reject) => {
    const timer = setTimeout(() => reject(new Error(timeout)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve4(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
  const live = () => {
    aborted();
    if (failureReason) throw new Error(failureReason);
    if (exitResult) throw new Error("sidecar_exited_early");
  };
  const onAbort = () => fail3("startup_aborted");
  const send = (message) => new Promise((resolve4, reject) => {
    try {
      if (!child.connected) throw new Error("ipc_lost");
      child.send(
        message,
        (error) => error ? reject(new Error("ipc_send_failed")) : resolve4()
      );
    } catch {
      reject(new Error("ipc_send_failed"));
    }
  });
  const stop = () => {
    if (cleanupDone)
      return Promise.resolve({
        exited: true,
        forced: false,
        cleanup: "already_stopped"
      });
    if (stopPromise2) return stopPromise2;
    stopPromise2 = (async () => {
      stopping = true;
      if (observationActive) fail3("idle_interrupted");
      signal?.removeEventListener("abort", onAbort);
      let forced = false;
      if (child && !exitResult) {
        try {
          await bounded(
            send({ type: "stop", nonce }),
            stopTimeoutMs,
            "stop_send_timeout"
          );
          await bounded(exited, stopTimeoutMs, "stop_timeout");
        } catch {
          uncertain = true;
          forced = true;
          try {
            child.kill("SIGKILL");
          } catch {
          }
          try {
            await bounded(exited, stopTimeoutMs, "exit_timeout");
          } catch {
          }
        }
      }
      if (spawnIntent && !child || child && (!exitResult || !recorded || !initialized || !scopeClosed || uncertain || exitResult.code !== 0 || exitResult.signal))
        return {
          exited: false,
          forced,
          cleanup: "incomplete",
          recoveryPath: root
        };
      try {
        if (Object.values(namespace2).some(
          (path2) => typeof path2 === "string" && isAbsolute3(path2) && overlaps(root, path2)
        ))
          throw new Error("disposable_root_overlap");
        await removeRoot(root, { recursive: true, force: false });
        cleanupDone = true;
        return { exited: true, forced, cleanup: "complete" };
      } catch {
        return {
          exited: false,
          forced,
          cleanup: "incomplete",
          recoveryPath: root
        };
      }
    })();
    return stopPromise2;
  };
  try {
    await checkedDirectory(root);
    if (Object.values(namespace2).some(
      (path2) => typeof path2 === "string" && isAbsolute3(path2) && overlaps(root, path2)
    ))
      throw new Error("disposable_root_overlap");
    await checkedDirectory(namespace2.root);
    for (const key2 of ["config", "data", "state"]) {
      if (!contains(namespace2.root, namespace2[key2]) || namespace2[key2] === namespace2.root)
        throw new Error("storage_denied");
      await checkedDirectory(namespace2[key2]);
    }
    for (const directory of ["home", "cache", "tmp", "workspace"])
      await createDirectory(join2(root, directory), {
        recursive: true,
        mode: 448
      });
    for (const directory of ["home", "cache", "tmp", "workspace"])
      await checkedDirectory(join2(root, directory));
    const configPath = join2(namespace2.config, "opencode");
    await createDirectory(configPath, { recursive: true, mode: 448 });
    await checkedDirectory(configPath);
    const configFile = join2(configPath, "opencode.json");
    try {
      await writeConfig(configFile, "{}\n", { flag: "wx", mode: 384 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat2 = await lstat2(configFile);
      if (!stat2.isFile() || stat2.isSymbolicLink() || stat2.nlink !== 1 || stat2.uid !== process.getuid() || stat2.mode & 63)
        throw new Error("storage_denied");
    }
    const database = join2(namespace2.data, "event-host.sqlite");
    for (const candidate of [
      database,
      `${database}-wal`,
      `${database}-shm`,
      `${database}-journal`
    ]) {
      try {
        const stat2 = await lstat2(candidate);
        if (!stat2.isFile() || stat2.isSymbolicLink() || stat2.nlink !== 1 || stat2.uid !== process.getuid() || stat2.mode & 63)
          throw new Error("storage_denied");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await guard();
    await validator(eventHost, { platform, arch });
    await guard();
    if ((await owner2.markSpawnIntent(owner2.getNonce())).state !== "ready")
      throw new Error("owner_unverified");
    spawnIntent = true;
    aborted();
    child = spawnProcess(eventHost.enginePath, [eventHost.hostPath], {
      cwd: workspace,
      env: {
        HOME: join2(root, "home"),
        XDG_CONFIG_HOME: configPath,
        XDG_DATA_HOME: namespace2.data,
        XDG_STATE_HOME: namespace2.state,
        XDG_CACHE_HOME: join2(root, "cache"),
        TMPDIR: join2(root, "tmp"),
        TMP: join2(root, "tmp"),
        TEMP: join2(root, "tmp"),
        OPENCODE_CONFIG_DIR: configPath,
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin"
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true
    });
    child.on("error", () => fail3("child_error"));
    child.once("exit", (code, exitSignal) => {
      exitResult = { code, signal: exitSignal };
      try {
        processIdentity2?.observeExit?.(child.pid);
      } catch {
        fail3("identity_exit_failed");
      }
      resolveExit(exitResult);
      if (!stopping || !scopeClosed) fail3("sidecar_exited_early");
    });
    child.on("disconnect", () => {
      if (!scopeClosed) fail3("ipc_lost");
    });
    child.on("message", (message) => {
      try {
        validateHostMessage(message, "parent");
        if (!initialized || message.nonce !== nonce || message.pid !== child.pid)
          throw new Error("invalid_ipc");
        if (message.type === "ready") {
          if (ready2 || stopping || message.engineVersion !== ENGINE || message.serverVersion !== VERSION || port && message.port !== port)
            throw new Error("invalid_ipc");
          ready2 = message;
          resolveReady(message);
        } else if (message.type === "scope-closed") {
          if (!stopping || scopeClosed || message.observerGap || message.live !== 0)
            throw new Error("scope_unconfirmed");
          scopeClosed = true;
        } else if (message.type === "observation") {
          if (!observationRequest || message.requestId !== observationRequest.requestId || stopping)
            throw new Error("unexpected_observation");
          observationRequest.resolve(message);
          observationRequest = void 0;
        } else fail3("child_hold");
      } catch {
        fail3("invalid_ipc");
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    const identity = await bounded(
      Promise.race([
        processIdentity2?.capture?.(child.pid),
        failed.then(() => {
          throw new Error("child_failed");
        })
      ]),
      startupTimeoutMs,
      "identity_timeout"
    );
    live();
    if (!identity || identity.pid !== child.pid || !Number.isSafeInteger(child.pid) || child.pid <= 0 || (await bounded(
      owner2.recordChild(owner2.getNonce(), identity),
      startupTimeoutMs,
      "record_timeout"
    )).state !== "ready")
      throw new Error("owner_unverified");
    ownedIdentity = identity;
    recorded = true;
    live();
    initialized = true;
    await bounded(
      send({
        type: "init",
        nonce,
        password,
        port,
        root,
        workspace,
        configPath,
        namespaceRoot: namespace2.root,
        dataPath: namespace2.data,
        statePath: namespace2.state,
        database,
        engineVersion: ENGINE,
        serverVersion: VERSION
      }),
      startupTimeoutMs,
      "init_timeout"
    );
    await bounded(
      Promise.race([
        readiness,
        failed.then(() => {
          throw new Error("child_failed");
        })
      ]),
      startupTimeoutMs,
      "sidecar_start_timeout"
    );
    live();
    const baseUrl = `http://127.0.0.1:${ready2.port}`;
    const factory = makeClient ?? (async (url, secret) => {
      const { OpenCode } = await Promise.resolve().then(() => (init_promise(), promise_exports));
      return OpenCode.make({
        baseUrl: url,
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}`
        },
        fetch: (request, init) => fetch(request, { ...init, redirect: "error" })
      });
    });
    const rawClient = await bounded(
      Promise.race([
        Promise.resolve().then(() => factory(baseUrl, password)),
        failed.then(() => {
          throw new Error("child_failed");
        })
      ]),
      requestTimeoutMs,
      "client_timeout"
    );
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]) : AbortSignal.timeout(requestTimeoutMs);
    const info = await bounded(
      Promise.race([
        rawClient.server.info({ signal: requestSignal }),
        failed.then(() => {
          throw new Error("child_failed");
        })
      ]),
      requestTimeoutMs,
      "identity_request_timeout"
    );
    if (info.pid !== child.pid || info.version !== VERSION)
      throw new Error("sidecar_identity_mismatch");
    live();
    const proxies = /* @__PURE__ */ new WeakMap();
    const track = (value) => {
      if (!value || typeof value !== "object" && typeof value !== "function")
        return value;
      if (proxies.has(value)) return proxies.get(value);
      if (typeof value === "function") {
        const wrapped = function(...args) {
          if (observationActive || stopping || uncertain || exitResult)
            throw new Error("event_host_held");
          pendingHostRequests++;
          try {
            const result = value.apply(this, args);
            if (result?.then)
              return Promise.resolve(result).then(
                (output) => {
                  if (!output?.[Symbol.asyncIterator]) pendingHostRequests--;
                  return output;
                },
                (error) => {
                  pendingHostRequests--;
                  throw error;
                }
              );
            if (!result?.[Symbol.asyncIterator]) pendingHostRequests--;
            return result;
          } catch (error) {
            pendingHostRequests--;
            throw error;
          }
        };
        proxies.set(value, wrapped);
        return wrapped;
      }
      const proxy = new Proxy(value, {
        get: (target, key2) => track(Reflect.get(target, key2))
      });
      proxies.set(value, proxy);
      return proxy;
    };
    const client = track(rawClient);
    const observeIdle = async () => {
      live();
      if (!connected || stopping || pendingHostRequests || observationActive)
        throw new Error("event_host_not_idle");
      observationActive = true;
      const checkOwner = async () => {
        if ((await owner2.assertOwned(owner2.getNonce())).state !== "ready")
          throw new Error("owner_unverified");
        const current = await processIdentity2.capture(child.pid);
        if (!current || Object.entries(ownedIdentity).some(
          ([key2, value]) => current[key2] !== value
        ))
          throw new Error("owner_unverified");
        live();
      };
      try {
        await bounded(
          checkOwner(),
          requestTimeoutMs,
          "observe_identity_timeout"
        );
        if (pendingHostRequests || observationRequest || stopping)
          throw new Error("event_host_not_idle");
        const requestId = randomBytes(32).toString("hex");
        const response = new Promise((resolve4) => {
          observationRequest = { requestId, resolve: resolve4 };
        });
        await bounded(
          send({ type: "observe", nonce, requestId }),
          requestTimeoutMs,
          "observe_send_timeout"
        );
        const observation = await bounded(
          Promise.race([
            response,
            failed.then(() => {
              throw new Error("child_failed");
            })
          ]),
          requestTimeoutMs,
          "observe_timeout"
        );
        await bounded(
          checkOwner(),
          requestTimeoutMs,
          "observe_identity_timeout"
        );
        if (observation.observerGap) {
          fail3("descendant_unverified");
          throw new Error("idle_proof_failed");
        }
        if (pendingHostRequests || stopping || observation.live !== 0 || !observation.allExited)
          throw new Error("event_host_not_idle");
        return {
          pid: child.pid,
          observerGap: false,
          live: 0,
          allExited: true,
          pendingHostRequests: 0,
          scope: "direct JS ChildProcess/Bun handles only"
        };
      } catch (error) {
        if (error.message !== "event_host_not_idle") fail3("idle_proof_failed");
        throw new Error(
          error.message === "event_host_not_idle" ? "event_host_not_idle" : "idle_proof_failed"
        );
      } finally {
        observationRequest = void 0;
        observationActive = false;
      }
    };
    connected = true;
    return {
      snapshot: () => exitResult || uncertain ? { state: "disconnected" } : { state: "connected", serverVersion: VERSION },
      workbenchContext: () => ({ client, session: void 0 }),
      stop,
      observeIdle,
      processId: child.pid,
      workspace,
      eventHost
    };
  } catch (error) {
    if (child) uncertain = true;
    const cleanup = await stop();
    const failure2 = new Error("OpenCode event host unavailable");
    failure2.reason = /^[a-z_]+$/.test(error.message) ? error.message : "event_host_failed";
    failure2.cleanupComplete = cleanup.exited && cleanup.cleanup === "complete";
    failure2.stopOwnedSidecar = stop;
    if (cleanup.recoveryPath) failure2.recoveryPath = cleanup.recoveryPath;
    throw failure2;
  } finally {
    if (!child || stopping) signal?.removeEventListener("abort", onAbort);
  }
}
var VERSION, ENGINE;
var init_event_host_supervisor = __esm({
  "apps/desktop-app/src/event-host-supervisor.mjs"() {
    "use strict";
    init_event_host_protocol();
    init_event_host_resources();
    VERSION = "2.0.18";
    ENGINE = "1.4.2";
  }
});

// apps/desktop-app/src/main.mjs
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { dirname as dirname2, join as join9 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// apps/desktop-app/src/sidecar-supervisor.mjs
init_promise();
import { randomUUID, createHash as createHash2 } from "node:crypto";
import { spawn as spawn2, execFile } from "node:child_process";
import {
  mkdir as mkdir2,
  mkdtemp as mkdtemp2,
  rm as rm2,
  writeFile as writeFile2,
  readFile,
  realpath as realpath2,
  lstat as lstat3,
  open as open2
} from "node:fs/promises";
import { tmpdir as tmpdir2 } from "node:os";
import {
  delimiter,
  join as join3,
  relative as relative3,
  isAbsolute as isAbsolute4,
  win32 as win32Path
} from "node:path";
var OPEN_CODE_VERSION = "2.0.18";
var STARTUP_TIMEOUT_MS = 2e4;
var REQUEST_TIMEOUT_MS = 5e3;
var STOP_TIMEOUT_MS = 5e3;
var MAX_STARTUP_OUTPUT = 32 * 1024;
function executableForResources(resourcesPath, platform, arch) {
  const file = platform === "win32" ? "opencode.exe" : "opencode";
  return join3(resourcesPath, "opencode", `${platform}-${arch}`, file);
}
function childEnvironment(root, platform, systemRoot = process.env.SystemRoot, namespace2) {
  const joinProfilePath = platform === "win32" ? win32Path.join : join3;
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: namespace2?.config ?? join3(root, "config"),
    XDG_DATA_HOME: namespace2?.data ?? join3(root, "data"),
    XDG_CACHE_HOME: join3(root, "cache"),
    XDG_STATE_HOME: namespace2?.state ?? join3(root, "state"),
    TMPDIR: join3(root, "tmp"),
    TMP: join3(root, "tmp"),
    TEMP: join3(root, "tmp"),
    OPENCODE_CONFIG_DIR: join3(
      namespace2?.config ?? join3(root, "config"),
      "opencode"
    ),
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    PATH: platform === "win32" ? join3(systemRoot ?? "C:\\Windows", "System32") : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter)
  };
  if (platform === "win32") {
    env.USERPROFILE = root;
    env.APPDATA = joinProfilePath(root, "AppData", "Roaming");
    env.LOCALAPPDATA = joinProfilePath(root, "AppData", "Local");
    if (systemRoot) env.SystemRoot = systemRoot;
  }
  return env;
}
function endpointFrom(output) {
  const urlText = output.match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0];
  const password = output.match(/server password\s+(\S+)/i)?.[1];
  if (!urlText || !password) return null;
  const url = new URL(urlText);
  const port = Number(url.port);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !port) {
    return null;
  }
  return { url: url.origin, password };
}
function safeError(error) {
  return error instanceof Error ? error.name : "RuntimeError";
}
function delay(ms) {
  return new Promise((resolve4) => setTimeout(resolve4, ms));
}
async function startSidecar({
  binaryPath,
  eventHost,
  spawnProcess = spawn2,
  createDirectory = mkdir2,
  writeConfig = writeFile2,
  removeRoot = rm2,
  makeClient = (baseUrl, password) => exports_client3.make({
    baseUrl,
    fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    }
  }),
  platform = process.platform,
  systemRoot = process.env.SystemRoot,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
  stopTimeoutMs = STOP_TIMEOUT_MS,
  port = 0,
  signal,
  namespace: namespace2,
  owner: owner2,
  processIdentity: processIdentity2,
  preflight
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("invalid_sidecar_port");
  }
  if (eventHost !== void 0) {
    const { startEventHost: startEventHost2 } = await Promise.resolve().then(() => (init_event_host_supervisor(), event_host_supervisor_exports));
    return startEventHost2({
      eventHost,
      namespace: namespace2,
      owner: owner2,
      processIdentity: processIdentity2,
      preflight,
      signal,
      port,
      platform,
      startupTimeoutMs,
      stopTimeoutMs,
      spawnProcess,
      createDirectory,
      writeConfig,
      removeRoot,
      makeClient
    });
  }
  const requireOwner = async () => {
    if (!owner2 || (await owner2.assertOwned(owner2.getNonce())).state !== "ready")
      throw new Error("owner_unverified");
  };
  if (namespace2) {
    await requireOwner();
    if (typeof preflight !== "function" || await preflight() !== true)
      throw new Error("native_startup_unverified");
  }
  const root = await mkdtemp2(join3(tmpdir2(), "oh-my-own-code-desktop-"));
  const workspace = join3(root, "workspace");
  let child;
  let startupOutput = "";
  let collectingStartupOutput = true;
  let exitResult;
  let resolveExit;
  let cleanupDone = false;
  let stopPromise2;
  const exited = new Promise((resolve4) => {
    resolveExit = resolve4;
  });
  const stopOwnedChild = () => {
    if (cleanupDone) {
      return Promise.resolve({
        exited: true,
        forced: false,
        cleanup: "already_stopped"
      });
    }
    if (stopPromise2) return stopPromise2;
    stopPromise2 = (async () => {
      if (child && !exitResult) child.kill("SIGTERM");
      let forced = false;
      if (child && !exitResult) {
        let result = await Promise.race([
          exited,
          delay(stopTimeoutMs).then(() => null)
        ]);
        if (result === null) {
          forced = true;
          child.kill("SIGKILL");
          result = await Promise.race([
            exited,
            delay(stopTimeoutMs).then(() => null)
          ]);
        }
        if (result === null)
          return { exited: false, forced, cleanup: "incomplete" };
      }
      try {
        if (namespace2 && Object.values(namespace2).some(
          (path2) => typeof path2 === "string" && isAbsolute4(path2) && pathsOverlap(root, path2)
        ))
          throw new Error("disposable_root_overlap");
        await removeRoot(root, { recursive: true, force: false });
        cleanupDone = true;
        return { exited: true, forced, cleanup: "complete" };
      } catch {
        return { exited: true, forced, cleanup: "failed", recoveryPath: root };
      }
    })().finally(() => {
      stopPromise2 = void 0;
    });
    return stopPromise2;
  };
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error("startup_aborted");
  };
  const requestSignal = () => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };
  try {
    const setupDirectories = [
      "config/opencode",
      "data",
      "cache",
      "state",
      "tmp",
      "workspace"
    ];
    if (platform === "win32") {
      setupDirectories.push("AppData/Roaming", "AppData/Local");
    }
    for (const relative7 of setupDirectories) {
      await createDirectory(join3(root, relative7), {
        recursive: true,
        mode: 448
      });
    }
    if (namespace2) {
      await requireOwner();
      for (const path2 of [
        namespace2.config,
        namespace2.data,
        namespace2.state,
        join3(namespace2.config, "opencode")
      ]) {
        await createDirectory(path2, { recursive: true, mode: 448 });
        if (await realpath2(path2) !== path2 || (await lstat3(path2)).isSymbolicLink())
          throw new Error("storage_denied");
      }
    }
    try {
      await writeConfig(
        join3(
          namespace2?.config ?? join3(root, "config"),
          "opencode",
          "opencode.json"
        ),
        "{}\n",
        {
          mode: 384,
          flag: "wx"
        }
      );
    } catch (error) {
      if (!namespace2 || error.code !== "EEXIST") throw error;
      const existing = await lstat3(
        join3(namespace2.config, "opencode", "opencode.json")
      );
      if (!existing.isFile() || existing.isSymbolicLink() || platform !== "win32" && (existing.uid !== process.getuid() || existing.mode & 63))
        throw new Error("storage_denied");
    }
    throwIfAborted();
    if (namespace2) {
      await requireOwner();
      const result = await owner2.markSpawnIntent(owner2.getNonce());
      if (result.state !== "ready") throw new Error(result.reason);
    }
    child = spawnProcess(
      binaryPath,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: workspace,
        env: childEnvironment(root, platform, systemRoot, namespace2),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );
    child.once("error", (error) => {
      if (child.pid === void 0) {
        exitResult = { kind: "error", error };
        resolveExit(exitResult);
      }
    });
    child.once("exit", (code, signal2) => {
      processIdentity2?.observeExit?.(child.pid);
      exitResult = { kind: "exit", code, signal: signal2 };
      resolveExit(exitResult);
    });
    const collect = (chunk) => {
      if (!collectingStartupOutput) return;
      startupOutput += chunk.toString("utf8");
      if (startupOutput.length > MAX_STARTUP_OUTPUT) {
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    if (namespace2) {
      const identity = await processIdentity2?.capture?.(child.pid);
      if (!identity || (await owner2.recordChild(owner2.getNonce(), identity)).state !== "ready")
        throw new Error("owner_unverified");
    }
    const deadline = Date.now() + startupTimeoutMs;
    let endpoint = null;
    while (Date.now() < deadline && !exitResult) {
      throwIfAborted();
      if (startupOutput.length > MAX_STARTUP_OUTPUT)
        throw new Error("startup_output_limit");
      endpoint = endpointFrom(startupOutput);
      if (endpoint) break;
      await delay(50);
    }
    if (!endpoint)
      throw new Error(
        exitResult ? "sidecar_exited_early" : "sidecar_start_timeout"
      );
    collectingStartupOutput = false;
    startupOutput = "";
    const client = makeClient(endpoint.url, endpoint.password);
    const info = await client.server.info({ signal: requestSignal() });
    if (info.pid !== child.pid || info.version !== OPEN_CODE_VERSION) {
      throw new Error("sidecar_identity_mismatch");
    }
    throwIfAborted();
    const session = namespace2 ? void 0 : await client.session.create(
      {
        title: "\uC784\uC2DC \uB370\uC2A4\uD06C\uD1B1 \uC791\uC5C5 \uACF5\uAC04",
        location: { directory: workspace }
      },
      { signal: requestSignal() }
    );
    throwIfAborted();
    return {
      snapshot() {
        return {
          ...exitResult ? { state: "disconnected" } : {
            state: "connected",
            serverVersion: OPEN_CODE_VERSION,
            ...session && {
              sessionTitle: "\uC784\uC2DC \uB370\uC2A4\uD06C\uD1B1 \uC791\uC5C5 \uACF5\uAC04",
              sessionId: session.id
            }
          }
        };
      },
      // Trusted main-process accessor; never included in a renderer snapshot.
      workbenchContext() {
        return { client, session };
      },
      stop: stopOwnedChild,
      processId: child.pid,
      workspace
    };
  } catch (error) {
    const cleanup = await stopOwnedChild();
    const failure2 = new Error(
      `OpenCode sidecar unavailable (${safeError(error)})`
    );
    failure2.cleanupComplete = cleanup.exited && cleanup.cleanup === "complete";
    failure2.stopOwnedSidecar = stopOwnedChild;
    if (cleanup.recoveryPath) failure2.recoveryPath = cleanup.recoveryPath;
    throw failure2;
  }
}
function pathsOverlap(a, b) {
  const contains2 = (parent, child) => {
    const path2 = relative3(parent, child);
    return !path2 || !path2.startsWith("..") && !isAbsolute4(path2);
  };
  return contains2(a, b) || contains2(b, a);
}
async function openDurableManifest(namespace2, owner2, { nativeDatabase } = {}) {
  if ((await owner2.assertOwned(owner2.getNonce())).state !== "ready")
    throw new Error("owner_unverified");
  const manifestPath = join3(namespace2.root, "manifest.json");
  const paths = {
    root: namespace2.root,
    metadata: namespace2.metadata,
    config: namespace2.config,
    data: namespace2.data,
    state: namespace2.state
  };
  if (nativeDatabase !== void 0) {
    if (nativeDatabase !== join3(namespace2.data, "event-host.sqlite"))
      throw new Error("identity_conflict");
    paths.database = nativeDatabase;
  }
  let manifest;
  try {
    const stat2 = await lstat3(manifestPath);
    if (!stat2.isFile() || stat2.isSymbolicLink() || stat2.size > 16384 || process.platform !== "win32" && (stat2.uid !== process.getuid() || stat2.mode & 63))
      throw new Error("identity_conflict");
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest || Object.keys(manifest).sort().join() !== [
      "schemaVersion",
      "storeId",
      "nativeVersion",
      "storageGeneration",
      "paths"
    ].sort().join() || manifest.schemaVersion !== 5 || manifest.nativeVersion !== OPEN_CODE_VERSION || manifest.storageGeneration !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      manifest.storeId
    ) || JSON.stringify(manifest.paths) !== JSON.stringify(paths))
      throw new Error("identity_conflict");
  } catch (error) {
    if (error.code !== "ENOENT" || !namespace2.fresh) throw error;
    manifest = {
      schemaVersion: 5,
      storeId: randomUUID(),
      nativeVersion: OPEN_CODE_VERSION,
      storageGeneration: 1,
      paths
    };
    const handle = await open2(manifestPath, "wx", 384);
    try {
      await handle.writeFile(`${JSON.stringify(manifest)}
`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const directory = await open2(namespace2.root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  for (const path2 of [
    namespace2.metadata,
    namespace2.config,
    namespace2.data,
    namespace2.state
  ]) {
    await mkdir2(path2, { recursive: true, mode: 448 });
    const stat2 = await lstat3(path2);
    if (await realpath2(path2) !== path2 || !stat2.isDirectory() || stat2.isSymbolicLink() || process.platform !== "win32" && (stat2.uid !== process.getuid() || stat2.mode & 63))
      throw new Error("storage_denied");
  }
  return Object.freeze(manifest);
}
var runProbe = (command, args) => new Promise(
  (resolve4, reject) => execFile(
    command,
    args,
    {
      timeout: 2e3,
      maxBuffer: 16384,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }
    },
    (error, stdout) => error ? reject(error) : resolve4(stdout.trim())
  )
);
var digestIdentity = (value) => createHash2("sha256").update(value).digest("hex");
function createOSProcessIdentityAdapter({
  platform = process.platform,
  probe = runProbe
} = {}) {
  const captured = /* @__PURE__ */ new Map();
  const exits = /* @__PURE__ */ new Set();
  async function bootId() {
    let value;
    if (platform === "darwin")
      value = await probe("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"]);
    if (platform === "linux")
      value = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
    if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    ))
      return value;
    throw new Error("process_identity_unavailable");
  }
  async function sample(pid = process.pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
      let token2;
      if (platform === "darwin") {
        const source = 'import ctypes,sys\nclass Info(ctypes.Structure):\n _fields_=[("prefix",ctypes.c_uint32*12),("comm",ctypes.c_char*16),("name",ctypes.c_char*32),("nfiles",ctypes.c_uint32),("pgid",ctypes.c_uint32),("pjobc",ctypes.c_uint32),("e_tdev",ctypes.c_uint32),("e_tpgid",ctypes.c_uint32),("nice",ctypes.c_int32),("sec",ctypes.c_uint64),("usec",ctypes.c_uint64)]\nx=Info(); lib=ctypes.CDLL("/usr/lib/libproc.dylib",use_errno=True); n=lib.proc_pidinfo(int(sys.argv[1]),3,0,ctypes.byref(x),ctypes.sizeof(x)); assert n==ctypes.sizeof(x) and x.sec>0; print(str(x.sec)+":"+str(x.usec))';
        token2 = await probe("/usr/bin/python3", ["-c", source, String(pid)]);
        if (!/^\d+:\d+$/.test(token2)) return null;
      } else if (platform === "linux") {
        const stat2 = await readFile(`/proc/${pid}/stat`, "utf8");
        token2 = stat2.slice(stat2.lastIndexOf(")") + 2).split(" ")[19];
        if (!/^\d+$/.test(token2)) return null;
      } else return null;
      const identity = Object.freeze({
        pid,
        platform,
        bootId: digestIdentity(await bootId()),
        startToken: digestIdentity(token2)
      });
      return identity;
    } catch {
      return null;
    }
  }
  async function capture(pid = process.pid) {
    const identity = await sample(pid);
    if (identity) captured.set(pid, identity);
    return identity;
  }
  return Object.freeze({
    capture,
    captureCurrent: () => capture(process.pid),
    observeExit(pid) {
      const identity = captured.get(pid);
      if (identity) exits.add(JSON.stringify(identity));
    },
    async inspect(expected) {
      const identity = expected;
      if (exits.has(JSON.stringify(expected)))
        return { state: "exited", identity, evidence: "owned_exit" };
      try {
        if (expected.platform === platform && digestIdentity(await bootId()) !== expected.bootId)
          return { state: "exited", identity, evidence: "os_identity" };
        const actual = await sample(expected.pid);
        if (!actual) return { state: "unverified" };
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          return { state: "identity_conflict" };
        return { state: "alive", identity, evidence: "os_identity" };
      } catch {
        return { state: "unverified" };
      }
    }
  });
}
function freshNativePreflight(namespace2, registry2) {
  return namespace2?.fresh === true && registry2?.status().state === "ready" && registry2.readView().retainedOperations.length === 0;
}

// apps/desktop-app/src/main.mjs
init_event_host_resources();

// apps/desktop-app/src/ephemeral-profile.mjs
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  lstatSync
} from "node:fs";
import { tmpdir as tmpdir3 } from "node:os";
import { join as join4, relative as relative4, isAbsolute as isAbsolute5 } from "node:path";
function configureEphemeralProfile(app2, parent = tmpdir3(), durableRoots = []) {
  const root = mkdtempSync(join4(parent, "oh-my-own-code-electron-"));
  if (durableRoots.some((path2) => overlaps2(root, path2)))
    throw new Error("disposable_root_overlap");
  const paths = {
    userData: join4(root, "user-data"),
    sessionData: join4(root, "session-data"),
    crashDumps: join4(root, "crash-dumps"),
    logs: join4(root, "logs")
  };
  for (const [name, path2] of Object.entries(paths)) {
    mkdirSync(path2, { recursive: true, mode: 448 });
    app2.setPath(name, path2);
  }
  let cleaned = false;
  return {
    root,
    paths,
    cleanup() {
      if (cleaned) return;
      if (durableRoots.some((path2) => overlaps2(root, path2)))
        throw new Error("disposable_root_overlap");
      rmSync(root, { recursive: true, force: false });
      cleaned = true;
    }
  };
}
function prepareDurableNamespace(app2) {
  const documents = realpathSync(app2.getPath("documents"));
  const parent = realpathSync(app2.getPath("appData"));
  const product = join4(parent, "OhMyOwnCode");
  const root = join4(product, "storage-v1");
  let fresh = false;
  for (const directory of [product, root]) {
    try {
      mkdirSync(directory, { mode: 448 });
      if (directory === root) fresh = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat2 = lstatSync(directory);
    if (!stat2.isDirectory() || stat2.isSymbolicLink() || process.platform !== "win32" && (stat2.uid !== process.getuid() || stat2.mode & 18))
      throw new Error("storage_denied");
  }
  if (realpathSync(root) !== root) throw new Error("storage_denied");
  return Object.freeze({
    root,
    documents,
    fresh,
    metadata: join4(root, "metadata"),
    config: join4(root, "native", "config"),
    data: join4(root, "native", "data"),
    state: join4(root, "native", "state")
  });
}
function overlaps2(a, b) {
  const contains2 = (parent, child) => {
    const path2 = relative4(parent, child);
    return !path2 || !path2.startsWith("..") && !isAbsolute5(path2);
  };
  return contains2(a, b) || contains2(b, a);
}

// apps/desktop-app/src/renderer-admission.mjs
function admitsRendererRequest(event, webContents, allowedUrl) {
  const frame = event?.senderFrame;
  return event?.sender === webContents && frame && frame === event.sender.mainFrame && allowedUrl(frame.url);
}
function acceptsNoIpcArguments(args) {
  return args.length === 0;
}

// apps/desktop-app/src/workbench-service.mjs
import { randomUUID as randomUUID3, createHash as createHash4 } from "node:crypto";

// apps/desktop-app/src/host/workbench-admission.mjs
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";

// apps/desktop-app/src/workbench-contract.mjs
var ERRORS = Object.freeze({
  READ_BUSY: "The read capacity is occupied.",
  READ_TIMEOUT: "The whole-read deadline expired.",
  STALE_EPOCH: "The runtime epoch is no longer current.",
  STALE_REVISION: "The expected revision is no longer current.",
  ARCHIVED_SESSION: "Restore this archived session before executing.",
  EMPTY_SESSION: "Add conversation history before forking this session.",
  HAS_DESCENDANTS: "Remove descendant conversations first.",
  DESCENDANTS_UNVERIFIED: "The descendant list could not be verified.",
  INVALID_REQUEST: "Invalid workbench request.",
  NOT_FOUND: "The workspace or session is not registered.",
  BUSY: "The session is busy or its outcome is unconfirmed.",
  CANCELLED: "The operation was cancelled.",
  UNAVAILABLE: "The runtime is unavailable.",
  AUTH_REQUIRED: "No verified model credentials are available.",
  POLICY_UNVERIFIED: "The required permission policy could not be verified.",
  INVALID_SELECTION: "The selected runtime option is unavailable.",
  STALE_PERMISSION: "This permission request is no longer pending.",
  DUPLICATE_CONFLICT: "This request ID was already used with different content.",
  LIMIT_REACHED: "The temporary workbench limit was reached.",
  FILE_DENIED: "This path cannot be accessed in the text preview.",
  FILE_UNSUPPORTED: "This file is not supported by the text preview.",
  FILE_TOO_LARGE: "This file exceeds the text preview limit.",
  RUNTIME_ERROR: "The runtime operation failed.",
  TOOL_ERROR: "A tool operation failed.",
  UNKNOWN_OUTCOME: "The operation outcome is unknown. It will not be resent automatically."
});
function failure(code) {
  return { ok: false, code, message: ERRORS[code] ?? ERRORS.RUNTIME_ERROR };
}
function fail2(code) {
  const error = new Error(ERRORS[code]);
  error.appCode = code;
  throw error;
}
var schemas = {
  "operation.lookup": [["runtimeEpoch", "operationId"], []],
  snapshot: [[], ["workspaceId", "sessionId"]],
  "diagnostics.list": [[], ["workspaceId", "sessionId"]],
  "session.rename": [["workspaceId", "sessionId", "requestId", "title"], []],
  "session.pin": [["workspaceId", "sessionId", "requestId", "pinned"], []],
  "session.archive": [
    ["workspaceId", "sessionId", "requestId", "archived"],
    []
  ],
  "session.fork": [["workspaceId", "sessionId", "requestId"], ["title"]],
  "session.remove": [["workspaceId", "sessionId", "requestId"], []],
  "workspace.import": [[], []],
  "workspace.create": [[], ["name"]],
  "workspace.remove": [["workspaceId"], []],
  "session.create": [["workspaceId"], ["title"]],
  "message.send": [
    ["workspaceId", "sessionId", "requestId", "text"],
    ["agent", "model"]
  ],
  "session.interrupt": [["workspaceId", "sessionId"], []],
  "permission.respond": [
    ["workspaceId", "sessionId", "requestId", "decision"],
    []
  ],
  "catalog.list": [["workspaceId"], ["sessionId"]],
  "command.run": [
    ["workspaceId", "sessionId", "requestId", "name", "arguments"],
    []
  ],
  "file.list": [["workspaceId"], ["path"]],
  "file.read": [["workspaceId", "path"], []]
};
function validateRequest(value) {
  assertPlain(value);
  const schema = Object.hasOwn(schemas, value.type) && schemas[value.type];
  if (!schema) fail2("INVALID_REQUEST");
  const [required, optional] = schema;
  const allowed = /* @__PURE__ */ new Set(["type", ...required, ...optional]);
  if (Object.keys(value).some((key2) => !allowed.has(key2)) || required.some((key2) => !Object.hasOwn(value, key2)))
    fail2("INVALID_REQUEST");
  for (const [key2, entry] of Object.entries(value)) {
    if (["pinned", "archived"].includes(key2)) {
      if (typeof entry !== "boolean") fail2("INVALID_REQUEST");
      continue;
    }
    if (["runtimeEpoch", "operationId"].includes(key2) && !validWireId(entry))
      fail2("INVALID_REQUEST");
    if (key2 === "requestId" && typeof entry === "string" && entry.length > 128)
      fail2("INVALID_REQUEST");
    const max = ["text", "arguments"].includes(key2) ? 32e3 : key2 === "path" ? 2048 : 256;
    if (typeof entry !== "string" || entry.length > max || entry.includes("\0"))
      fail2("INVALID_REQUEST");
    if ((key2.endsWith("Id") || ["agent", "model"].includes(key2)) && !/^[\w.:-]{1,256}$/.test(entry))
      fail2("INVALID_REQUEST");
  }
  if (value.sessionId && !value.workspaceId) fail2("INVALID_REQUEST");
  if (value.type === "message.send" && !value.text.trim())
    fail2("INVALID_REQUEST");
  if (value.type === "permission.respond" && !["once", "reject"].includes(value.decision))
    fail2("INVALID_REQUEST");
  if (["session.rename", "session.fork"].includes(value.type) && Object.hasOwn(value, "title")) {
    if (!value.title.trim() || value.title.trim().length > 120 || [...value.title].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159
    ))
      fail2("INVALID_REQUEST");
    return { ...value, title: value.title.trim() };
  }
  return { ...value };
}
var BASELINE_POLICY = Object.freeze([
  Object.freeze({ action: "*", resource: "*", effect: "ask" }),
  Object.freeze({
    action: "external_directory",
    resource: "*",
    effect: "deny"
  }),
  Object.freeze({ action: "subagent", resource: "*", effect: "deny" })
]);
function policyMatches(rules) {
  return Array.isArray(rules) && rules.length === BASELINE_POLICY.length && rules.every(
    (rule, index) => rule && Object.keys(rule).length === 3 && ["action", "resource", "effect"].every(
      (key2) => rule[key2] === BASELINE_POLICY[index][key2]
    )
  );
}
function portableName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 100 && !/[<>:"/\\|?*]/.test(name) && ![...name].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159
  ) && !/[. ]$/.test(name) && name === name.trim() && !/^\.{1,2}$/.test(name) && !/^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(
    name
  );
}
var READ_TYPES = Object.freeze([
  "snapshot",
  "diagnostics.list",
  "catalog.list",
  "file.list",
  "file.read",
  "operation.lookup"
]);
function validWireId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
function assertPlain(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(
    (key2) => typeof key2 !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key2), "value")
  ))
    fail2("INVALID_REQUEST");
}
function closed2(value, allowed) {
  assertPlain(value);
  if (Object.keys(value).some((key2) => !allowed.includes(key2)))
    fail2("INVALID_REQUEST");
}
function validateEnvelope(value) {
  closed2(value, [
    "version",
    "runtimeEpoch",
    "readId",
    "operationId",
    "expectedRevision",
    "operation"
  ]);
  if (value.version !== 2) fail2("INVALID_REQUEST");
  const operation = validateRequest(value.operation);
  const read = READ_TYPES.includes(operation.type);
  const bootstrap = operation.type === "snapshot";
  if (read) {
    if (!validWireId(value.readId) || Object.hasOwn(value, "operationId") || Object.hasOwn(value, "expectedRevision"))
      fail2("INVALID_REQUEST");
    if ((!bootstrap || Object.hasOwn(value, "runtimeEpoch")) && !validWireId(value.runtimeEpoch))
      fail2("INVALID_REQUEST");
  } else if (!validWireId(value.operationId) || !validWireId(value.runtimeEpoch) || Object.hasOwn(value, "readId"))
    fail2("INVALID_REQUEST");
  if (Object.hasOwn(value, "expectedRevision") && (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0))
    fail2("INVALID_REQUEST");
  return { ...value, operation };
}
function validateCancel(value) {
  closed2(value, ["version", "runtimeEpoch", "readId"]);
  if (value.version !== 2 || !validWireId(value.runtimeEpoch) || !validWireId(value.readId))
    fail2("INVALID_REQUEST");
  return { ...value };
}
var STORE_RECOVERY_REASONS = Object.freeze([
  "owner_conflict",
  "owner_unverified",
  "corrupt_journal",
  "unsupported_version",
  "identity_conflict",
  "unconfirmed_tail",
  "writer_poisoned",
  "pending_inbox",
  "native_startup_unverified",
  "storage_denied",
  "retained_limit"
]);
var RESOURCE_RECOVERY_REASONS = Object.freeze([
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation"
]);
var resourceId = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
function requiredObject(value, required, optional = []) {
  closed2(value, [...required, ...optional]);
  if (!required.every((key2) => Object.hasOwn(value, key2)))
    fail2("INVALID_REQUEST");
}
function needDTO(condition) {
  if (!condition) fail2("INVALID_REQUEST");
}
var nonnegativeClock = (value) => Number.isSafeInteger(value) && value >= 0;
var boundedText = (value, max) => typeof value === "string" && value.length <= max;
function unique(entries, key2) {
  needDTO(new Set(entries.map(key2)).size === entries.length);
}
function validateSnapshot(value) {
  requiredObject(
    value,
    [
      "runtimeEpoch",
      "revision",
      "observationSequence",
      "state",
      "temporary",
      "recovery",
      "retainedOperations",
      "workspaces",
      "sessions",
      "messages",
      "permissions"
    ],
    ["selectedWorkspaceId", "selectedSessionId", "error"]
  );
  needDTO(
    validWireId(value.runtimeEpoch) && nonnegativeClock(value.revision) && Number.isSafeInteger(value.observationSequence) && value.observationSequence > 0
  );
  needDTO(
    ["connected", "disconnected", "unavailable"].includes(value.state) && typeof value.temporary === "boolean"
  );
  for (const [name, limit] of [
    ["workspaces", 100],
    ["sessions", 200],
    ["messages", 100],
    ["permissions", 100],
    ["retainedOperations", 2048]
  ])
    needDTO(Array.isArray(value[name]) && value[name].length <= limit);
  for (const w of value.workspaces) {
    requiredObject(w, [
      "id",
      "name",
      "path",
      "kind",
      "trusted",
      "trustRevision",
      "temporary"
    ]);
    needDTO(
      resourceId(w.id) && boundedText(w.name, 256) && boundedText(w.path, 4096) && ["folder", "repository", "worktree"].includes(w.kind) && typeof w.trusted === "boolean" && nonnegativeClock(w.trustRevision) && typeof w.temporary === "boolean"
    );
  }
  unique(value.workspaces, (w) => w.id);
  const workspaces = new Set(value.workspaces.map((w) => w.id));
  for (const s of value.sessions) {
    requiredObject(
      s,
      ["id", "workspaceId", "title", "status"],
      ["pinned", "archived", "parentSessionId"]
    );
    needDTO(
      resourceId(s.id) && workspaces.has(s.workspaceId) && boundedText(s.title, 256) && ["idle", "running", "stopping", "unknown", "unavailable"].includes(
        s.status
      )
    );
    for (const flag of ["pinned", "archived"])
      if (Object.hasOwn(s, flag)) needDTO(typeof s[flag] === "boolean");
    if (Object.hasOwn(s, "parentSessionId"))
      needDTO(resourceId(s.parentSessionId));
  }
  unique(value.sessions, (s) => s.id);
  const sessions = new Map(value.sessions.map((s) => [s.id, s.workspaceId]));
  for (const s of value.sessions)
    if (s.parentSessionId)
      needDTO(
        sessions.get(s.parentSessionId) === s.workspaceId && s.parentSessionId !== s.id
      );
  if (Object.hasOwn(value, "selectedWorkspaceId"))
    needDTO(workspaces.has(value.selectedWorkspaceId));
  if (Object.hasOwn(value, "selectedSessionId"))
    needDTO(
      sessions.has(value.selectedSessionId) && sessions.get(value.selectedSessionId) === value.selectedWorkspaceId
    );
  requiredObject(value.recovery, ["store", "resources"]);
  const store = value.recovery.store;
  requiredObject(
    store,
    ["state"],
    store?.state === "recovery_required" ? ["reason"] : []
  );
  needDTO(
    store.state === "ready" || store.state === "recovery_required" && STORE_RECOVERY_REASONS.includes(store.reason)
  );
  needDTO(
    Array.isArray(value.recovery.resources) && value.recovery.resources.length <= 300
  );
  for (const r of value.recovery.resources) {
    requiredObject(r, ["workspaceId", "state", "reason"], ["sessionId"]);
    needDTO(
      workspaces.has(r.workspaceId) && r.state === "unavailable" && RESOURCE_RECOVERY_REASONS.includes(r.reason)
    );
    if (Object.hasOwn(r, "sessionId"))
      needDTO(sessions.get(r.sessionId) === r.workspaceId);
  }
  unique(
    value.recovery.resources,
    (r) => JSON.stringify([r.workspaceId, r.sessionId])
  );
  for (const k of value.retainedOperations) {
    requiredObject(
      k,
      ["runtimeEpoch", "operationId", "type"],
      ["workspaceId", "sessionId"]
    );
    needDTO(
      validWireId(k.runtimeEpoch) && validWireId(k.operationId) && Object.hasOwn(schemas, k.type) && !READ_TYPES.includes(k.type)
    );
    for (const field of ["workspaceId", "sessionId"])
      if (Object.hasOwn(k, field)) needDTO(resourceId(k[field]));
    needDTO(!k.sessionId || !!k.workspaceId);
  }
  unique(
    value.retainedOperations,
    (k) => JSON.stringify([k.runtimeEpoch, k.operationId])
  );
  for (const m of value.messages) {
    requiredObject(m, ["id", "role", "text", "tools"]);
    needDTO(
      boundedText(m.id, 256) && m.id.length > 0 && ["user", "assistant"].includes(m.role) && boundedText(m.text, 32e3) && Array.isArray(m.tools) && m.tools.length <= 40
    );
    for (const t of m.tools) {
      requiredObject(t, ["id", "name", "status", "input", "output"]);
      needDTO(
        boundedText(t.id, 256) && t.id.length > 0 && boundedText(t.name, 128) && ["pending", "running", "completed", "error"].includes(t.status) && boundedText(t.input, 8e3) && boundedText(t.output, 8e3)
      );
    }
  }
  for (const p of value.permissions) {
    requiredObject(p, ["id", "sessionId", "title", "detail"]);
    needDTO(
      boundedText(p.id, 256) && p.id.length > 0 && sessions.has(p.sessionId) && boundedText(p.title, 128) && boundedText(p.detail, 2e3)
    );
  }
  if (Object.hasOwn(value, "error")) {
    requiredObject(value.error, ["code", "message"]);
    needDTO(
      Object.hasOwn(ERRORS, value.error.code) && value.error.message === ERRORS[value.error.code]
    );
  }
  if (store.state === "recovery_required")
    needDTO(
      value.state === "unavailable" && !value.messages.length && !value.permissions.length
    );
  return value;
}

// apps/desktop-app/src/host/workbench-receipts.mjs
var id = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var optionalId = (key2, value) => id(value) ? { [key2]: value } : {};
function redactReceipt(record) {
  const result = record.result;
  let projected;
  if (result) {
    switch (result.kind) {
      case "created":
        projected = {
          kind: "created",
          workspaceId: result.workspaceId,
          ...optionalId("sessionId", result.sessionId),
          ...optionalId("nativeSessionId", result.nativeSessionId)
        };
        break;
      case "forked":
        if (id(result.sessionId) && id(result.nativeSessionId))
          projected = {
            kind: "forked",
            workspaceId: result.workspaceId,
            sessionId: result.sessionId,
            nativeSessionId: result.nativeSessionId
          };
        break;
      case "removed":
        projected = {
          kind: "removed",
          workspaceId: result.workspaceId,
          workspaceRemoved: result.workspaceRemoved === true,
          ...Array.isArray(result.removedSessionIds) && {
            removedSessionIds: result.removedSessionIds.filter(id).slice(0, 200)
          }
        };
        break;
      case "metadata":
        if (id(result.sessionId))
          projected = {
            kind: "metadata",
            workspaceId: result.workspaceId,
            sessionId: result.sessionId
          };
        break;
      case "delivery":
        if (["accepted", "stopping", "decided"].includes(result.status))
          projected = {
            kind: "delivery",
            status: result.status,
            ...optionalId("nativeInboxId", result.nativeInboxId),
            ...optionalId("nativeRequestId", result.nativeRequestId)
          };
        break;
      case "rejected":
        if (Object.hasOwn(ERRORS, result.code))
          projected = { kind: "rejected", code: result.code };
        break;
    }
    if (projected?.workspaceId && !id(projected.workspaceId))
      projected = void 0;
  }
  return {
    runtimeEpoch: record.runtimeEpoch,
    operationId: record.operationId,
    type: record.type,
    ...optionalId("workspaceId", record.workspaceId),
    ...optionalId("sessionId", record.sessionId),
    admission: record.admission,
    delivery: record.delivery,
    effect: record.effect,
    revision: record.revision,
    evidence: record.evidence.slice(0, 8).filter((e) => id(e.kind) && (e.id === void 0 || id(e.id))).map((e) => ({ kind: e.kind, ...optionalId("id", e.id) })),
    ...projected && { result: projected }
  };
}

// apps/desktop-app/src/host/workbench-admission.mjs
var execution = new AsyncLocalStorage();
var currentScope = () => execution.getStore();
var digest = (value) => createHash3("sha256").update(
  JSON.stringify(
    Object.keys(value).sort().map((k) => [k, value[k]])
  )
).digest("hex");
var errorResult = (error) => failure(
  Object.hasOwn(ERRORS, error?.appCode) ? error.appCode : "RUNTIME_ERROR"
);
function readClass(type) {
  if (type === "operation.lookup") return "lookup";
  if (type === "catalog.list") return "catalog";
  if (type.startsWith("file.")) return "files";
  return "snapshot";
}
var readyWaits = /* @__PURE__ */ new WeakMap();
function waitForReady(ready2, signal) {
  let state = readyWaits.get(ready2);
  if (!state) {
    state = { waiters: /* @__PURE__ */ new Set(), settled: false };
    readyWaits.set(ready2, state);
    const settle = (value, error) => {
      state.settled = true;
      state.value = value;
      state.error = error;
      for (const notify of [...state.waiters]) notify();
      state.waiters.clear();
    };
    ready2.then(
      (value) => settle(value),
      (error) => settle(void 0, error)
    );
  }
  return new Promise((resolve4, reject) => {
    const cleanup = () => {
      state.waiters.delete(notify);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(Object.assign(new Error("deadline"), { appCode: "READ_TIMEOUT" }));
    };
    const notify = () => {
      cleanup();
      if (state.error !== void 0) reject(state.error);
      else resolve4(state.value);
    };
    if (signal.aborted) return abort();
    if (state.settled) return notify();
    state.waiters.add(notify);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function createHostAdmission({
  execute,
  ready: ready2,
  revision,
  projectReceipt,
  deadlineMs = 1e4,
  registry: getRegistry,
  runtimeEpoch: runtimeEpoch2,
  mutationAllowed = () => true
}) {
  const epoch = runtimeEpoch2 ?? randomUUID2();
  const service = new AbortController();
  const tasks = /* @__PURE__ */ new Map();
  const subscribers = /* @__PURE__ */ new Map();
  const ledger = /* @__PURE__ */ new Map();
  const sdkLanes = /* @__PURE__ */ new Set();
  const actuals = /* @__PURE__ */ new Set();
  let quiescing = false;
  let mutation;
  function trackActual(fn) {
    const actual = Promise.resolve().then(fn).finally(() => actuals.delete(actual));
    actuals.add(actual);
    return actual;
  }
  function scope(kind, record) {
    const controller = new AbortController();
    const value = {
      kind,
      record,
      controller,
      signal: AbortSignal.any([service.signal, controller.signal]),
      deadline: performance.now() + deadlineMs,
      sdkActive: false,
      effectStarted: false
    };
    value.check = () => {
      if (service.signal.aborted) fail2("UNAVAILABLE");
      if ((value.signal.aborted || performance.now() >= value.deadline) && !(kind === "mutation" && value.effectStarted))
        fail2("READ_TIMEOUT");
    };
    value.markEffect = () => {
      value.check();
      if (kind === "mutation" && !value.finalizing && (value.signal.aborted || performance.now() >= value.deadline))
        fail2("READ_TIMEOUT");
      if (record) {
        value.effectStarted = true;
        record.admission = "dispatched";
        record.effect = "pending";
      }
    };
    return value;
  }
  async function sdk(fn, args, effect = false, primary = false) {
    const owner2 = currentScope();
    if (!owner2) fail2("INVALID_REQUEST");
    owner2.check();
    if (owner2.kind === "mutation" && !owner2.finalizing && (owner2.signal.aborted || performance.now() >= owner2.deadline))
      fail2("READ_TIMEOUT");
    const lane = ["startup", "mutation", "trusted"].includes(owner2.kind) ? "shared" : owner2.kind;
    if (sdkLanes.has(lane) || sdkLanes.size >= 4) fail2("READ_BUSY");
    if (typeof fn !== "function") fail2("UNAVAILABLE");
    if (primary && owner2.kind === "mutation") owner2.finalizing = true;
    sdkLanes.add(lane);
    owner2.sdkActive = true;
    const signal = owner2.kind === "mutation" && owner2.effectStarted && owner2.signal.aborted ? service.signal : owner2.signal;
    const actual = trackActual(async () => {
      try {
        owner2.check();
        if (effect) {
          await owner2.beforeEffect?.(fn, args);
          owner2.check();
          owner2.markEffect();
        }
        return await fn(...args, { signal });
      } finally {
        owner2.sdkActive = false;
        sdkLanes.delete(lane);
      }
    });
    const result = owner2.kind === "trusted" ? await waitForReady(actual, signal) : await actual;
    owner2.check();
    return result;
  }
  function lookup(request) {
    const key2 = {
      runtimeEpoch: request.runtimeEpoch,
      operationId: request.operationId
    };
    if (getRegistry?.()) return getRegistry().lookup(key2);
    if (request.runtimeEpoch !== epoch)
      return { ...key2, status: "wrong_epoch", effect: "unknown" };
    const record = ledger.get(request.operationId);
    return record ? { ...key2, status: "found", receipt: redactReceipt(record) } : { ...key2, status: "missing", effect: "unknown" };
  }
  function settleSubscriber(sub, result) {
    if (!subscribers.has(sub.key)) return;
    subscribers.delete(sub.key);
    sub.task.subs.delete(sub.key);
    clearTimeout(sub.timer);
    sub.resolve(result);
    if (!sub.task.subs.size) {
      sub.task.quarantined = true;
      sub.task.owner.controller.abort();
    }
  }
  function read(envelope, sender) {
    const kind = readClass(envelope.operation.type);
    const key2 = JSON.stringify([sender, epoch, envelope.readId]);
    const identity2 = JSON.stringify([
      sender,
      epoch,
      digest(envelope.operation)
    ]);
    const active = subscribers.get(key2);
    if (active)
      return active.identity === identity2 ? active.promise : Promise.resolve(failure("INVALID_REQUEST"));
    let task = tasks.get(kind);
    if (task && (task.identity !== identity2 || task.quarantined || task.owner.signal.aborted))
      return Promise.resolve(failure("READ_BUSY"));
    if (task?.subs.size >= 8) return Promise.resolve(failure("READ_BUSY"));
    let start = false;
    if (!task) {
      task = {
        identity: identity2,
        owner: scope(kind),
        subs: /* @__PURE__ */ new Map(),
        quarantined: false
      };
      tasks.set(kind, task);
      start = true;
    }
    let resolve4;
    const promise = new Promise((r) => {
      resolve4 = r;
    });
    const sub = { key: key2, sender, identity: identity2, task, promise, resolve: resolve4 };
    task.subs.set(key2, sub);
    subscribers.set(key2, sub);
    sub.timer = setTimeout(
      () => settleSubscriber(sub, failure("READ_TIMEOUT")),
      Math.max(0, task.owner.deadline - performance.now())
    );
    if (start) {
      task.timer = setTimeout(
        () => {
          task.quarantined = true;
          task.owner.controller.abort();
          for (const item of [...task.subs.values()])
            settleSubscriber(item, failure("READ_TIMEOUT"));
        },
        Math.max(0, task.owner.deadline - performance.now())
      );
      task.actual = trackActual(
        () => execution.run(task.owner, async () => {
          try {
            await Promise.resolve();
            task.owner.check();
            const result = kind === "lookup" ? { ok: true, value: lookup(envelope.operation) } : await execute(envelope.operation);
            task.owner.check();
            for (const item of [...task.subs.values()])
              settleSubscriber(item, result);
          } catch (error) {
            for (const item of [...task.subs.values()])
              settleSubscriber(item, errorResult(error));
          } finally {
            clearTimeout(task.timer);
            tasks.delete(kind);
          }
        })
      );
    }
    return promise;
  }
  function rejectRecord(record, code) {
    return trackActual(async () => {
      if (getRegistry) {
        const registry2 = getRegistry();
        if (!registry2 || registry2.status().state !== "ready")
          return failure("UNAVAILABLE");
        try {
          const existing = registry2.lookup({
            runtimeEpoch: record.runtimeEpoch,
            operationId: record.operationId
          });
          if (existing.status === "found") {
            const result = await registry2.complete({
              runtimeEpoch: record.runtimeEpoch,
              operationId: record.operationId,
              receipt: {
                ...redactReceipt(record),
                admission: "rejected",
                delivery: "pending",
                effect: "none",
                result: { kind: "rejected", code }
              },
              delta: { workspaces: [], sessions: [], tombstones: [] }
            });
            Object.assign(record, result.receipt);
          } else {
            const result = await registry2.begin({
              ...identity(record),
              rejectionCode: code
            });
            Object.assign(record, result.receipt);
          }
        } catch {
          return failure("UNAVAILABLE");
        }
      }
      record.admission = "rejected";
      record.effect = "none";
      record.result = { kind: "rejected", code };
      record.revision = revision();
      return { ...failure(code), receipt: redactReceipt(record) };
    });
  }
  function identity(record) {
    return {
      runtimeEpoch: record.runtimeEpoch,
      operationId: record.operationId,
      type: record.type,
      digest: record.digest,
      ...record.workspaceId && { workspaceId: record.workspaceId },
      ...record.sessionId && { sessionId: record.sessionId }
    };
  }
  function mutate(envelope) {
    const { operationId, operation } = envelope;
    const hash3 = digest({
      ...operation,
      expectedRevision: envelope.expectedRevision ?? null
    });
    const registry2 = getRegistry?.();
    if (!mutationAllowed()) return Promise.resolve(failure("UNAVAILABLE"));
    if (getRegistry && (!registry2 || registry2.status().state !== "ready"))
      return Promise.resolve(failure("UNAVAILABLE"));
    const old = ledger.get(operationId);
    if (old && registry2) {
      if (old.digest !== hash3)
        return Promise.resolve(failure("DUPLICATE_CONFLICT"));
      const duplicate = () => {
        const durable = registry2.lookup({ runtimeEpoch: epoch, operationId });
        return durable.status === "found" ? {
          ok: true,
          value: { status: "duplicate" },
          receipt: durable.receipt
        } : failure("UNAVAILABLE");
      };
      return registry2.lookup({ runtimeEpoch: epoch, operationId }).status === "found" ? Promise.resolve(duplicate()) : old.response.then(duplicate);
    }
    if (old)
      return Promise.resolve(
        old.digest === hash3 ? {
          ok: true,
          value: { status: "duplicate" },
          receipt: redactReceipt(old)
        } : failure("DUPLICATE_CONFLICT")
      );
    if (ledger.size >= 2048) return Promise.resolve(failure("LIMIT_REACHED"));
    const admittedRevision = revision();
    if (quiescing || service.signal.aborted)
      return Promise.resolve(failure("UNAVAILABLE"));
    const record = {
      runtimeEpoch: epoch,
      operationId,
      type: operation.type,
      workspaceId: operation.workspaceId,
      sessionId: operation.sessionId,
      digest: hash3,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: admittedRevision,
      evidence: []
    };
    ledger.set(operationId, record);
    if (mutation) return Promise.resolve(rejectRecord(record, "BUSY"));
    if (envelope.expectedRevision !== void 0 && envelope.expectedRevision !== admittedRevision)
      return Promise.resolve(rejectRecord(record, "STALE_REVISION"));
    const owner2 = scope("mutation", record);
    mutation = owner2;
    let resolve4;
    let settled = false;
    const response = new Promise((r) => {
      resolve4 = r;
    });
    record.response = response;
    const finishResponse = (result) => {
      if (!settled) {
        settled = true;
        resolve4(result);
      }
    };
    const expire = () => {
      if (service.signal.aborted) clearTimeout(timer);
      owner2.controller.abort();
      if (owner2.effectStarted) {
        record.delivery = "unknown";
        record.effect = "unknown";
        record.revision = revision();
        finishResponse({
          ...failure("UNKNOWN_OUTCOME"),
          receipt: redactReceipt(record)
        });
      } else void rejectRecord(record, "READ_TIMEOUT").then(finishResponse);
    };
    const timer = setTimeout(expire, deadlineMs);
    service.signal.addEventListener("abort", expire, { once: true });
    owner2.actual = trackActual(
      () => execution.run(owner2, async () => {
        try {
          if (registry2) {
            const admission = await registry2.begin({
              ...identity(record),
              ...envelope.expectedRevision !== void 0 && {
                expectedRevision: envelope.expectedRevision
              }
            });
            Object.assign(record, admission.receipt);
            if (admission.status !== "admitted") {
              finishResponse(
                admission.status === "duplicate" ? {
                  ok: true,
                  value: { status: "duplicate" },
                  receipt: redactReceipt(record)
                } : {
                  ...failure(record.result.code),
                  receipt: redactReceipt(record)
                }
              );
              return;
            }
          }
          await waitForReady(ready2(), owner2.signal);
          owner2.check();
          if (!registry2 && envelope.expectedRevision !== void 0 && envelope.expectedRevision !== revision())
            fail2("STALE_REVISION");
          const result = await execute(operation);
          owner2.check();
          if (!service.signal.aborted)
            await projectReceipt(
              record,
              operation,
              result,
              owner2.effectStarted
            );
          finishResponse({ ...result, receipt: redactReceipt(record) });
        } catch (error) {
          if (!owner2.effectStarted)
            finishResponse(
              await rejectRecord(
                record,
                registry2 && registry2.status().state !== "ready" ? "UNAVAILABLE" : errorResult(error).code
              )
            );
          else {
            record.delivery = "unknown";
            record.effect = "unknown";
            record.revision = revision();
            if (registry2) {
              const durable = registry2.lookup({
                runtimeEpoch: epoch,
                operationId
              });
              if (durable.status === "found")
                Object.assign(record, durable.receipt);
            }
            finishResponse({
              ...registry2?.status().state === "recovery_required" ? failure("UNAVAILABLE") : errorResult(error),
              receipt: redactReceipt(record)
            });
          }
        } finally {
          clearTimeout(timer);
          service.signal.removeEventListener("abort", expire);
          if (mutation === owner2) mutation = void 0;
        }
      })
    );
    return response;
  }
  function internal(kind, fn) {
    if (quiescing || service.signal.aborted)
      return Promise.reject(
        Object.assign(new Error("unavailable"), { appCode: "UNAVAILABLE" })
      );
    const owner2 = scope(kind);
    const timer = setTimeout(() => owner2.controller.abort(), deadlineMs);
    return trackActual(async () => {
      try {
        return await execution.run(owner2, fn);
      } finally {
        clearTimeout(timer);
      }
    });
  }
  return {
    epoch,
    sdk,
    lookup,
    handle(value, sender) {
      try {
        if (typeof sender !== "string" || !sender || sender.length > 256)
          fail2("INVALID_REQUEST");
        if (quiescing || service.signal.aborted) fail2("UNAVAILABLE");
        const envelope = validateEnvelope(value);
        if (envelope.runtimeEpoch !== void 0 && envelope.runtimeEpoch !== epoch)
          fail2("STALE_EPOCH");
        return READ_TYPES.includes(envelope.operation.type) ? read(envelope, sender) : mutate(envelope);
      } catch (error) {
        return Promise.resolve(errorResult(error));
      }
    },
    cancel(value, sender) {
      try {
        if (typeof sender !== "string" || !sender) fail2("INVALID_REQUEST");
        const cancel = validateCancel(value);
        if (service.signal.aborted) fail2("UNAVAILABLE");
        if (cancel.runtimeEpoch !== epoch) fail2("STALE_EPOCH");
        const sub = subscribers.get(
          JSON.stringify([sender, epoch, cancel.readId])
        );
        if (sub) settleSubscriber(sub, failure("CANCELLED"));
        return { ok: true, value: { status: sub ? "cancelled" : "missing" } };
      } catch (error) {
        return errorResult(error);
      }
    },
    closeSender(sender) {
      for (const sub of [...subscribers.values()])
        if (sub.sender === sender) settleSubscriber(sub, failure("CANCELLED"));
    },
    close() {
      service.abort();
      for (const sub of [...subscribers.values()])
        settleSubscriber(sub, failure("UNAVAILABLE"));
      for (const task of tasks.values()) {
        clearTimeout(task.timer);
        task.quarantined = true;
      }
    },
    async drain() {
      quiescing = true;
      while (actuals.size) await Promise.allSettled([...actuals]);
    },
    startup(fn) {
      return internal("startup", fn);
    },
    // Explicit service-only fixture adapter; main/preload never export it.
    trusted(fn) {
      return internal("trusted", fn);
    }
  };
}

// apps/desktop-app/src/workbench-service.mjs
import { performance as performance2 } from "node:perf_hooks";
import { basename } from "node:path";
import { isDeepStrictEqual } from "node:util";

// apps/desktop-app/src/host/workbench-files.mjs
import { constants as constants2 } from "node:fs";
import { lstat as lstat4, realpath as realpath3, open as open3, opendir, mkdir as mkdir3 } from "node:fs/promises";
import { join as join5, relative as relative5, isAbsolute as isAbsolute6, sep as sep2 } from "node:path";
import { randomBytes as randomBytes2 } from "node:crypto";
var MAX_FILE_BYTES = 256 * 1024;
function sensitiveName(name) {
  return /^(\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.config|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|auth\.json|opencode\.jsonc?|id_(rsa|ed25519|ecdsa)(?:\.pub)?)$/i.test(
    name
  ) || /\.(pem|key|p12|pfx|keystore)$/i.test(name);
}
async function canonicalDirectory(path2) {
  const canonical = await realpath3(path2);
  if (!(await lstat4(canonical)).isDirectory()) fail2("FILE_DENIED");
  return canonical;
}
function relativeParts(path2 = "") {
  if (typeof path2 !== "string" || path2.length > 2048 || isAbsolute6(path2) || /[\\:]/.test(path2) || [...path2].some((char) => char.charCodeAt(0) < 32))
    fail2("FILE_DENIED");
  if (!path2) return [];
  const parts = path2.split("/");
  if (parts.some(
    (part) => !part || part === "." || part === ".." || sensitiveName(part)
  ))
    fail2("FILE_DENIED");
  return parts;
}
async function checkedPath(root, path2) {
  const parts = relativeParts(path2);
  if (await realpath3(root) !== root || (await lstat4(root)).isSymbolicLink())
    fail2("FILE_DENIED");
  let current = root;
  for (const part of parts) {
    current = join5(current, part);
    if ((await lstat4(current)).isSymbolicLink()) fail2("FILE_DENIED");
  }
  const canonical = await realpath3(current);
  const rel = relative5(root, canonical);
  if (rel === ".." || rel.startsWith(`..${sep2}`) || isAbsolute6(rel))
    fail2("FILE_DENIED");
  return canonical;
}
async function listFiles(root, path2 = "") {
  const target = await checkedPath(root, path2);
  const entries = [];
  const directory = await opendir(target);
  for await (const entry of directory) {
    if (sensitiveName(entry.name) || entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory())
      continue;
    entries.push({
      name: entry.name,
      path: [path2, entry.name].filter(Boolean).join("/"),
      type: entry.isDirectory() ? "directory" : "file"
    });
    if (entries.length >= 500) break;
  }
  if (await checkedPath(root, path2) !== target) fail2("FILE_DENIED");
  return {
    path: path2,
    entries: entries.sort((a, b) => a.name.localeCompare(b.name))
  };
}
async function readFilePreview(root, path2) {
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|woff2?|ttf|mp[34]|mov|exe|dll|dylib|so|db|sqlite3?)$/i.test(
    path2
  ))
    fail2("FILE_UNSUPPORTED");
  const target = await checkedPath(root, path2);
  const before = await lstat4(target);
  if (!before.isFile()) fail2("FILE_DENIED");
  if (before.size > MAX_FILE_BYTES) fail2("FILE_TOO_LARGE");
  const file = await open3(
    target,
    constants2.O_RDONLY | (constants2.O_NOFOLLOW ?? 0) | (constants2.O_NONBLOCK ?? 0)
  );
  try {
    const stat2 = await file.stat();
    if (!stat2.isFile() || stat2.dev !== before.dev || stat2.ino !== before.ino || await checkedPath(root, path2) !== target)
      fail2("FILE_DENIED");
    if (stat2.size > MAX_FILE_BYTES) fail2("FILE_TOO_LARGE");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES) fail2("FILE_TOO_LARGE");
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.some(
      (byte) => byte === 0 || byte < 32 && ![9, 10, 13].includes(byte)
    ))
      fail2("FILE_UNSUPPORTED");
    let content;
    try {
      content = new globalThis.TextDecoder("utf-8", { fatal: true }).decode(
        bytes
      );
    } catch {
      fail2("FILE_UNSUPPORTED");
    }
    const after = await lstat4(target);
    if (after.dev !== stat2.dev || after.ino !== stat2.ino || await checkedPath(root, path2) !== target)
      fail2("FILE_DENIED");
    return { path: path2, content, truncated: false };
  } finally {
    await file.close();
  }
}
function uuidV7(now = Date.now()) {
  const bytes = randomBytes2(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = bytes[6] & 15 | 112;
  bytes[8] = bytes[8] & 63 | 128;
  const hex2 = bytes.toString("hex");
  return `${hex2.slice(0, 8)}-${hex2.slice(8, 12)}-${hex2.slice(12, 16)}-${hex2.slice(16, 20)}-${hex2.slice(20)}`;
}
function defaultFolderName(date = /* @__PURE__ */ new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${uuidV7(date.getTime())}`;
}
async function createFolder(parent, name) {
  const root = await canonicalDirectory(parent);
  if (name?.trim() && !portableName(name)) fail2("INVALID_REQUEST");
  for (let attempt = 0; attempt < 5; attempt++) {
    const child = name?.trim() ? name : defaultFolderName();
    if (await canonicalDirectory(parent) !== root) fail2("FILE_DENIED");
    const target = join5(root, child);
    try {
      await mkdir3(target, { recursive: false, mode: 448 });
    } catch (error) {
      if (error.code === "EEXIST" && !name?.trim()) continue;
      throw error;
    }
    if (await checkedPath(root, child) !== target) fail2("FILE_DENIED");
    return target;
  }
  fail2("LIMIT_REACHED");
}

// apps/desktop-app/src/workbench-service.mjs
var lifecycleTypes = /* @__PURE__ */ new Set([
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove"
]);
var mutationTypes = /* @__PURE__ */ new Set([
  ...lifecycleTypes,
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "command.run",
  "session.interrupt",
  "permission.respond"
]);
var clip = (value, size = 8e3) => typeof value === "string" ? value.slice(0, size) : "";
var opaque = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;
var available = (entries) => ({ status: "available", entries });
var unavailable = () => ({ status: "unavailable", entries: [] });
var emptyCatalog = () => Object.fromEntries(
  ["commands", "skills", "mcp", "agents", "models"].map((key2) => [
    key2,
    unavailable()
  ])
);
var fingerprint = (request) => createHash4("sha256").update(
  JSON.stringify(
    Object.keys(request).sort().map((key2) => [key2, request[key2]])
  )
).digest("hex");
function structuredError(error) {
  return error?.status === 401 || error?.status === 403 || error?.type === "ProviderAuthError" ? "AUTH_REQUIRED" : "RUNTIME_ERROR";
}
function projectMessages(data) {
  if (!Array.isArray(data)) fail2("RUNTIME_ERROR");
  return data.slice(-100).filter(
    (message) => opaque(message.id) && ["user", "assistant"].includes(message.type)
  ).map((message) => ({
    id: message.id,
    role: message.type,
    text: message.type === "user" ? clip(message.text, 32e3) : clip(
      (message.content ?? []).filter((part) => part.type === "text").map((part) => clip(part.text, 32e3)).join(""),
      32e3
    ),
    tools: message.type === "assistant" ? (message.content ?? []).filter((part) => part.type === "tool" && opaque(part.id)).slice(0, 40).map((part) => ({
      id: part.id,
      name: clip(part.name, 128),
      status: part.state?.status === "streaming" ? "pending" : ["running", "completed", "error"].includes(
        part.state?.status
      ) ? part.state.status : "error",
      input: clip(
        typeof part.state?.input === "string" ? part.state.input : JSON.stringify(part.state?.input ?? {})
      ),
      output: !["streaming", "running", "completed"].includes(
        part.state?.status
      ) ? ERRORS.TOOL_ERROR : clip(
        (part.state?.content ?? []).filter((item) => item.type === "text").map((item) => clip(item.text)).join("\n")
      )
    })) : []
  }));
}
function createWorkbenchService({
  runtime: runtime2,
  pickDirectory,
  confirmTrust,
  confirmSessionRemoval = async () => false,
  deadlineMs = 1e4,
  trustedTestAdapter = false,
  registry: registryInput,
  runtimeReady,
  runtimeEpoch: runtimeEpoch2,
  recoveryReason,
  bootstrap = false
}) {
  let committed = { workspaces: /* @__PURE__ */ new Map(), sessions: /* @__PURE__ */ new Map() };
  const nativeProjections = /* @__PURE__ */ new Map();
  const resourceGenerations = /* @__PURE__ */ new Map();
  function tables() {
    return currentScope()?.candidate ?? committed;
  }
  function cloneTables() {
    return {
      workspaces: new Map(
        [...committed.workspaces].map(([id3, w]) => [id3, { ...w }])
      ),
      sessions: new Map(
        [...committed.sessions].map(([id3, s]) => [
          id3,
          {
            ...s,
            status: nativeProjections.get(id3)?.status ?? s.status,
            awaiting: nativeProjections.get(id3)?.awaiting ?? s.awaiting,
            receipts: new Map(s.receipts),
            invalidPermissions: new Set(s.invalidPermissions)
          }
        ])
      )
    };
  }
  let registry2;
  let localRecovery = recoveryReason;
  let observationSequence = 0;
  let initializing = true;
  const storageReady = Promise.resolve(registryInput).then((value) => {
    registry2 = value;
  });
  storageReady.catch((error) => {
    localRecovery = error?.storageReason ?? "storage_denied";
  });
  const reads = /* @__PURE__ */ new Map();
  const lifecycleReceipts = /* @__PURE__ */ new Map();
  const diagnostics = {
    startedAt: Date.now(),
    observedOperations: 0,
    errors: 0,
    unknownOutcomes: 0,
    droppedEvents: 0,
    events: []
  };
  function observe(request, result, started, owned) {
    const unknown = result.code === "UNKNOWN_OUTCOME" || result.value?.status === "unknown";
    const code = unknown ? "UNKNOWN_OUTCOME" : Object.hasOwn(ERRORS, result.code) ? result.code : void 0;
    const status = unknown ? "unknown" : result.ok ? "ok" : code === "CANCELLED" ? "cancelled" : "error";
    const elapsed = performance2.now() - started;
    diagnostics.observedOperations++;
    if (status === "error") diagnostics.errors++;
    if (unknown) diagnostics.unknownOutcomes++;
    diagnostics.events.push({
      id: randomUUID3(),
      timestamp: Date.now(),
      operation: request.type,
      ...owned,
      status,
      durationMs: Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 864e5)) : 0,
      ...code && { code }
    });
    if (diagnostics.events.length > 500) {
      diagnostics.events.shift();
      diagnostics.droppedEvents++;
    }
  }
  const controller = new AbortController();
  let revision = 0;
  let defaultWorkspace;
  let defaultSession;
  let context = runtime2?.workbenchContext?.();
  let client = context?.client;
  let ready2;
  const host = createHostAdmission({
    execute: handleRequest,
    ready: () => ready2,
    revision: () => registry2?.status().revision ?? revision,
    registry: registryInput !== void 0 ? () => registry2 : void 0,
    runtimeEpoch: runtimeEpoch2,
    mutationAllowed: () => !localRecovery && (registryInput === void 0 || !initializing),
    projectReceipt,
    deadlineMs
  });
  let effectMethods = new Set(
    [
      client?.session?.update,
      client?.session?.create,
      client?.session?.fork,
      client?.session?.remove,
      client?.session?.switchAgent,
      client?.session?.switchModel,
      client?.session?.prompt,
      client?.session?.command,
      client?.session?.interrupt,
      client?.permission?.reply
    ].filter(Boolean)
  );
  function checkLive() {
    currentScope()?.check();
    if (controller.signal.aborted) fail2("UNAVAILABLE");
  }
  function storageCheck() {
    if (localRecovery || registryInput !== void 0 && (!registry2 || registry2.status().state !== "ready"))
      fail2("UNAVAILABLE");
  }
  async function markEffect(step = "registry.metadata") {
    checkLive();
    if (registry2) {
      storageCheck();
      const owner2 = currentScope();
      if (!owner2?.record) fail2("UNAVAILABLE");
      const result = await registry2.dispatch({
        ...operationKey3(owner2.record),
        step
      });
      if (result.status !== "dispatched") fail2("UNKNOWN_OUTCOME");
    }
    currentScope()?.markEffect();
  }
  const operationKey3 = (record) => ({
    runtimeEpoch: record.runtimeEpoch,
    operationId: record.operationId
  });
  function methodStep(fn, args) {
    if (fn === client.session.create) return "native.create";
    if (fn === client.session.fork) return "native.fork";
    if (fn === client.session.remove) return "native.remove";
    if (fn === client.session.update)
      return Object.hasOwn(args[0], "title") ? "native.rename" : currentScope().policyStep ?? "native.policy";
    if (fn === client.session.switchAgent) return "native.agent";
    if (fn === client.session.switchModel) return "native.model";
    if (fn === client.session.prompt) return "native.send";
    if (fn === client.session.command) return "native.command";
    if (fn === client.session.interrupt) return "native.interrupt";
    if (fn === client.permission.reply) return "native.permission";
    fail2("UNAVAILABLE");
  }
  async function call(fn, ...args) {
    checkLive();
    if (!client || runtime2.snapshot().state !== "connected")
      fail2("UNAVAILABLE");
    const primary = [
      client.session?.create,
      client.session?.fork,
      client.session?.remove,
      client.session?.prompt,
      client.session?.command,
      client.session?.interrupt,
      client.permission?.reply
    ].includes(fn) || fn === client.session?.update && Object.hasOwn(args[0] ?? {}, "title");
    const owner2 = currentScope();
    owner2.beforeEffect = async (effectFn, effectArgs) => {
      if (!registry2) return;
      storageCheck();
      if (!owner2.record) fail2("UNAVAILABLE");
      const result = await registry2.dispatch({
        ...operationKey3(owner2.record),
        step: methodStep(effectFn, effectArgs),
        ...effectArgs[0]?.sessionID && {
          nativeSessionId: effectArgs[0].sessionID
        }
      });
      if (result.status !== "dispatched") fail2("UNKNOWN_OUTCOME");
      owner2.effectStarted = true;
    };
    const effect = effectMethods.has(fn) || [
      client.session?.create,
      client.session?.fork,
      client.session?.update,
      client.session?.remove,
      client.session?.switchAgent,
      client.session?.switchModel,
      client.session?.prompt,
      client.session?.command,
      client.session?.interrupt,
      client.permission?.reply
    ].includes(fn);
    return host.sdk(fn, args, effect, primary);
  }
  function projectReceiptFields(record, request, response, effected) {
    record.revision = revision;
    const value = response.value;
    if (!registry2 && !response.ok && record.verifiedNone) {
      record.admission = "rejected";
      record.delivery = "pending";
      record.effect = "none";
      record.result = { kind: "rejected", code: response.code };
      return;
    }
    if (!response.ok || value?.status === "unknown") {
      record.delivery = effected ? "unknown" : "pending";
      record.effect = effected ? "unknown" : "none";
      if (!effected) {
        record.admission = "rejected";
        record.result = { kind: "rejected", code: response.code };
      }
      return;
    }
    const w = value?.selectedWorkspaceId ?? request.workspaceId;
    const sid = value?.selectedSessionId ?? request.sessionId;
    if (["workspace.import", "workspace.create", "session.create"].includes(
      request.type
    )) {
      record.result = {
        kind: "created",
        workspaceId: w,
        ...sid && {
          sessionId: sid,
          nativeSessionId: tables().sessions.get(sid)?.sdkId
        }
      };
    } else if (request.type === "session.fork") {
      record.result = {
        kind: "forked",
        workspaceId: w,
        sessionId: sid,
        nativeSessionId: tables().sessions.get(sid)?.sdkId
      };
    } else if (["workspace.remove", "session.remove"].includes(request.type)) {
      record.result = {
        kind: "removed",
        workspaceId: request.workspaceId,
        workspaceRemoved: request.type === "workspace.remove",
        removedSessionIds: record.removedSessionIds ?? [request.sessionId].filter(Boolean)
      };
    } else if (["session.rename", "session.pin", "session.archive"].includes(
      request.type
    )) {
      record.result = {
        kind: "metadata",
        workspaceId: request.workspaceId,
        sessionId: request.sessionId
      };
    } else {
      const receipt = tables().sessions.get(request.sessionId)?.receipts.get(record.operationId);
      record.result = {
        kind: "delivery",
        status: value.status,
        ...receipt?.inboxId && { nativeInboxId: receipt.inboxId },
        ...request.type === "permission.respond" && {
          nativeRequestId: request.requestId
        }
      };
      record.delivery = "accepted";
      record.effect = "pending";
      record.evidence = [
        {
          kind: "native-ack",
          ...receipt?.inboxId ? { id: receipt.inboxId } : request.type === "permission.respond" ? { id: request.requestId } : {}
        }
      ];
      return;
    }
    record.admission = "dispatched";
    record.delivery = "accepted";
    record.effect = "confirmed";
    record.evidence = [
      {
        kind: "host-registry",
        id: record.result.sessionId ?? record.result.workspaceId
      }
    ];
  }
  function workspaceRecord(w, state = "registered") {
    return {
      workspaceId: w.id,
      ownership: w.ownership ?? (w.temporary ? "legacy" : "imported"),
      canonicalPath: w.path,
      registrationState: state,
      ...w.folderSessionId && { folderSessionId: w.folderSessionId },
      name: w.name,
      trustRevision: w.trustRevision
    };
  }
  function sessionRecord(s, partial = false) {
    return {
      appSessionId: s.id,
      workspaceId: s.workspaceId,
      nativeSessionId: s.sdkId,
      lifecycleState: partial ? "unavailable" : "active",
      pinned: !!s.pinned,
      archived: !!s.archived,
      title: s.title,
      ...s.parentSessionId && { parentSessionId: s.parentSessionId },
      ...partial && { recoveryReason: "partial_native_mapping" }
    };
  }
  async function projectReceipt(record, request, response, effected) {
    projectReceiptFields(record, request, response, effected);
    const owner2 = currentScope();
    const candidate = owner2?.candidate;
    if (!candidate) return;
    if (registry2) {
      storageCheck();
      const delta = { workspaces: [], sessions: [], tombstones: [] };
      const partial = !response.ok || response.value?.status === "unknown";
      if (!partial) {
        for (const [id3, w] of candidate.workspaces) {
          const old = committed.workspaces.get(id3);
          if (!old || !isDeepStrictEqual(workspaceRecord(old), workspaceRecord(w)))
            delta.workspaces.push(workspaceRecord(w));
        }
        for (const [id3, s] of candidate.sessions) {
          const old = committed.sessions.get(id3);
          if (!old || !isDeepStrictEqual(sessionRecord(old), sessionRecord(s)))
            delta.sessions.push(sessionRecord(s));
        }
        for (const id3 of committed.sessions.keys())
          if (!candidate.sessions.has(id3))
            delta.tombstones.push({ kind: "session", id: id3 });
        for (const id3 of committed.workspaces.keys())
          if (!candidate.workspaces.has(id3))
            delta.tombstones.push({ kind: "workspace", id: id3 });
      } else {
        for (const [id3, s] of candidate.sessions)
          if (!committed.sessions.has(id3) && owner2.verifiedNativeIds?.has(s.sdkId)) {
            delta.sessions.push(sessionRecord(s, true));
            s.status = "unavailable";
            s.unknown = true;
            s.unavailable = true;
            const w = candidate.workspaces.get(s.workspaceId);
            if (!committed.workspaces.has(w.id))
              delta.workspaces.push(workspaceRecord(w, "unavailable"));
          }
      }
      const completed = await registry2.complete({
        ...operationKey3(record),
        receipt: redactReceipt(record),
        delta,
        verifiedNativeSessionIds: [...owner2.verifiedNativeIds ?? []]
      });
      Object.assign(record, completed.receipt);
      if (partial) hydrateRegistry(true);
      else committed = candidate;
    } else {
      committed = candidate;
      revision++;
      record.revision = revision;
    }
    for (const id3 of candidate.sessions.keys()) nativeProjections.delete(id3);
    owner2.candidate = void 0;
    if (response.ok && response.value?.runtimeEpoch) {
      const wid = response.value.selectedWorkspaceId;
      const sid = response.value.selectedSessionId;
      response.value = base(
        committed.workspaces.get(wid),
        committed.sessions.get(sid)
      );
    }
  }
  function hydrateRegistry(preserveLive = false) {
    if (!registry2) return;
    const view = registry2.readView();
    committed = {
      workspaces: new Map(
        view.workspaces.map((w) => [
          w.workspaceId,
          {
            id: w.workspaceId,
            path: w.canonicalPath,
            name: w.name ?? basename(w.canonicalPath),
            ownership: w.ownership,
            folderSessionId: w.folderSessionId,
            kind: "folder",
            trusted: preserveLive ? committed.workspaces.get(w.workspaceId)?.trusted ?? false : false,
            trustRevision: w.trustRevision ?? 0,
            temporary: false,
            lock: false
          }
        ])
      ),
      sessions: new Map(
        view.sessions.map((s) => [
          s.appSessionId,
          {
            id: s.appSessionId,
            workspaceId: s.workspaceId,
            sdkId: s.nativeSessionId,
            title: s.title ?? "Untitled session",
            status: s.status,
            pinned: s.pinned,
            archived: s.archived,
            parentSessionId: s.parentSessionId,
            unavailable: s.status === "unavailable",
            unknown: s.status === "unavailable",
            lock: false,
            receipts: new Map(
              preserveLive ? committed.sessions.get(s.appSessionId)?.receipts : void 0
            ),
            invalidPermissions: new Set(
              preserveLive ? committed.sessions.get(s.appSessionId)?.invalidPermissions : void 0
            ),
            messages: [],
            permissions: [],
            generation: 0
          }
        ])
      )
    };
    defaultWorkspace = committed.workspaces.keys().next().value;
    defaultSession = committed.sessions.keys().next().value;
  }
  function workspace(id3) {
    checkLive();
    const value = tables().workspaces.get(id3);
    if (!value) fail2("NOT_FOUND");
    return value;
  }
  function session(wid, sid) {
    const value = tables().sessions.get(sid);
    if (!value || value.workspaceId !== wid || !tables().workspaces.has(wid))
      fail2("NOT_FOUND");
    return value;
  }
  async function recheck(w) {
    const generation = resourceGenerations.get(w.id) ?? 0;
    const matches = () => {
      const current = tables().workspaces.get(w.id);
      return current && current.path === w.path && current.trustRevision === w.trustRevision && current.trusted === w.trusted && (resourceGenerations.get(w.id) ?? 0) === generation;
    };
    if (!matches() || await canonicalDirectory(w.path) !== w.path || !matches())
      fail2("FILE_DENIED");
    checkLive();
  }
  function addWorkspace(path2, trusted, temporary = false, reservation) {
    checkLive();
    const old = [...tables().workspaces.values()].find((w2) => w2.path === path2);
    if (old) return old;
    if (tables().workspaces.size >= 100) fail2("LIMIT_REACHED");
    const w = {
      id: reservation?.workspace.workspaceId ?? randomUUID3(),
      name: reservation?.workspace.name ?? basename(path2),
      ownership: reservation?.workspace.ownership,
      folderSessionId: reservation?.workspace.folderSessionId,
      path: path2,
      kind: "folder",
      trusted,
      trustRevision: 1,
      temporary,
      lock: false
    };
    tables().workspaces.set(w.id, w);
    if (!currentScope()?.candidate) revision++;
    return w;
  }
  async function addSession(w, info) {
    const owner2 = currentScope();
    const reservation = owner2?.reservation;
    if (!opaque(info?.id) || await canonicalDirectory(info.location?.directory) !== w.path || [...tables().sessions.values()].some((s2) => s2.sdkId === info.id))
      fail2("RUNTIME_ERROR");
    if (registry2 && owner2.record?.type === "session.fork") {
      const parent = tables().sessions.get(owner2.record.sessionId);
      if (!parent || info?.parentID !== parent.sdkId && info?.fork?.sessionID !== parent.sdkId)
        fail2("UNKNOWN_OUTCOME");
    }
    if (registry2 && (!reservation || reservation.plannedNativeSessionId && info.id !== reservation.plannedNativeSessionId || reservation.plannedNativeSessionId && !isDeepStrictEqual(info.metadata, owner2.nativeMetadata)))
      fail2("UNKNOWN_OUTCOME");
    if (registry2) {
      owner2.verifiedNativeIds ??= /* @__PURE__ */ new Set();
      owner2.verifiedNativeIds.add(info.id);
    }
    checkLive();
    if (tables().workspaces.get(w.id) !== w) fail2("NOT_FOUND");
    const s = {
      id: reservation?.appSessionId ?? randomUUID3(),
      workspaceId: w.id,
      sdkId: info.id,
      title: clip(info.title, 256) || "Untitled session",
      status: "idle",
      lock: false,
      unknown: false,
      pinned: false,
      archived: false,
      receipts: /* @__PURE__ */ new Map(),
      invalidPermissions: /* @__PURE__ */ new Set(),
      messages: [],
      permissions: [],
      generation: 0
    };
    tables().sessions.set(s.id, s);
    const record = currentScope()?.record;
    if (record && ["session.create", "session.fork"].includes(record.type)) {
      record.result = {
        kind: record.type === "session.fork" ? "forked" : "created",
        workspaceId: w.id,
        sessionId: s.id,
        nativeSessionId: s.sdkId
      };
      record.evidence = [{ kind: "native-session", id: s.sdkId }];
    }
    if (!currentScope()?.candidate) revision++;
    return s;
  }
  async function reserveSession(w, ownership, path2, name, fork = false) {
    if (!registry2) return;
    storageCheck();
    const owner2 = currentScope();
    const plannedNativeSessionId = fork ? void 0 : `ses_${randomUUID3().replaceAll("-", "")}`;
    owner2.reservation = await registry2.reserve({
      ...operationKey3(owner2.record),
      ...w ? { workspaceId: w.id } : {
        ownership,
        ...path2 && { canonicalPath: path2 },
        ...name && { name }
      },
      ...plannedNativeSessionId && { plannedNativeSessionId }
    });
    owner2.nativeMetadata = {
      operationId: owner2.record.operationId,
      originalRuntimeEpoch: owner2.record.runtimeEpoch,
      appSessionId: owner2.reservation.appSessionId,
      workspaceId: owner2.reservation.workspace.workspaceId,
      digest: owner2.record.digest
    };
    return owner2.reservation;
  }
  async function policy(s, step = "native.policy") {
    try {
      currentScope().policyStep = step;
      await call(client.session.update, {
        sessionID: s.sdkId,
        permissions: BASELINE_POLICY.map((rule) => ({ ...rule }))
      });
      const info = await call(client.session.get, { sessionID: s.sdkId });
      if (info?.id !== s.sdkId || await canonicalDirectory(info.location?.directory) !== workspace(s.workspaceId).path || !policyMatches(info.permissions))
        fail2("POLICY_UNVERIFIED");
      s.policyError = false;
      return info;
    } catch {
      checkLive();
      s.policyError = true;
      fail2("POLICY_UNVERIFIED");
    }
  }
  const registryLoaded = storageReady.then(() => hydrateRegistry()).catch((error) => {
    localRecovery = error?.storageReason ?? "storage_denied";
  });
  ready2 = host.startup(async () => {
    await registryLoaded;
    if (registryInput !== void 0) storageCheck();
    if (registry2?.readView().retainedOperations.length) {
      localRecovery = "native_startup_unverified";
      return;
    }
    if (runtimeReady) {
      runtime2 = await runtimeReady;
      context = runtime2?.workbenchContext?.();
      client = context?.client;
    }
    if (registry2) {
      const view = registry2.readView();
      if (view.retainedOperations.length) {
        localRecovery = "native_startup_unverified";
        return;
      }
      for (const existing of committed.sessions.values()) {
        if (existing.unavailable) continue;
        const info = await call(client?.session?.get, {
          sessionID: existing.sdkId
        });
        const w2 = committed.workspaces.get(existing.workspaceId);
        const metadata = info?.metadata;
        const correlation = metadata && registry2.lookup({
          runtimeEpoch: metadata.originalRuntimeEpoch,
          operationId: metadata.operationId
        });
        const admitted = metadata && registry2.lookupIdentity({
          runtimeEpoch: metadata.originalRuntimeEpoch,
          operationId: metadata.operationId
        });
        const expectedMetadata = admitted && {
          operationId: admitted.operationId,
          originalRuntimeEpoch: admitted.runtimeEpoch,
          appSessionId: existing.id,
          workspaceId: existing.workspaceId,
          digest: admitted.digest
        };
        if (!expectedMetadata || !isDeepStrictEqual(metadata, expectedMetadata) || info?.id !== existing.sdkId || await canonicalDirectory(info?.location?.directory) !== w2.path || metadata?.appSessionId !== existing.id || correlation?.status !== "found" || correlation.receipt.effect !== "confirmed" || correlation.receipt.result?.nativeSessionId !== existing.sdkId) {
          localRecovery = "identity_conflict";
          return;
        }
      }
      if (bootstrap && committed.workspaces.size === 0) {
        const owner2 = currentScope();
        const operation = { type: "workspace.create", name: "Workbench" };
        const record = {
          runtimeEpoch: host.epoch,
          operationId: randomUUID3(),
          type: operation.type,
          digest: fingerprint(operation),
          admission: "admitted",
          delivery: "pending",
          effect: "none",
          revision: registry2.status().revision,
          evidence: []
        };
        await registry2.begin({
          runtimeEpoch: record.runtimeEpoch,
          operationId: record.operationId,
          type: record.type,
          digest: record.digest
        });
        owner2.record = record;
        owner2.candidate = cloneTables();
        const reservation = await reserveSession(
          void 0,
          "managed",
          void 0,
          "Workbench"
        );
        await registry2.materializeManaged(operationKey3(record));
        owner2.effectStarted = true;
        const w2 = addWorkspace(
          reservation.workspace.canonicalPath,
          true,
          false,
          reservation
        );
        const info = await call(client.session.create, {
          id: reservation.plannedNativeSessionId,
          metadata: owner2.nativeMetadata,
          title: "Workbench",
          location: { directory: w2.path },
          permissions: BASELINE_POLICY.map((rule) => ({ ...rule }))
        });
        const checked = await call(client.session.get, {
          sessionID: info.id
        });
        const s2 = await addSession(w2, checked);
        defaultWorkspace = w2.id;
        defaultSession = s2.id;
        let result;
        try {
          await policy(s2);
          result = { ok: true, value: base(w2, s2) };
        } catch {
          result = failure("POLICY_UNVERIFIED");
        }
        await projectReceipt(record, operation, result, true);
      }
      return;
    }
    if (!client || !context?.session) return;
    const path2 = await canonicalDirectory(runtime2.workspace);
    const w = addWorkspace(path2, true, true);
    const s = await addSession(w, context.session);
    defaultWorkspace = w.id;
    defaultSession = s.id;
    try {
      await policy(s);
    } catch {
      checkLive();
    }
  }).catch((error) => {
    if (registryInput !== void 0 && !localRecovery)
      localRecovery = registry2?.status().reason ?? error?.storageReason ?? "native_startup_unverified";
  }).finally(() => {
    initializing = false;
  });
  ready2.catch(() => {
  });
  runtimeReady?.catch(() => {
  });
  function recoveryDTO() {
    const view = registry2?.readView();
    return {
      store: localRecovery ? { state: "recovery_required", reason: localRecovery } : view?.recovery.store ?? { state: "ready" },
      resources: view?.recovery.resources ?? []
    };
  }
  function base(w, s, projection) {
    checkLive();
    if (currentScope()?.candidate)
      return {
        runtimeEpoch: host.epoch,
        ...w && { selectedWorkspaceId: w.id },
        ...s && { selectedSessionId: s.id }
      };
    const view = registry2?.readView();
    const publishedWorkspaces = view ? view.workspaces.map((entry) => ({
      id: entry.workspaceId,
      name: entry.name ?? basename(entry.canonicalPath),
      path: entry.canonicalPath,
      kind: "folder",
      trusted: committed.workspaces.get(entry.workspaceId)?.trusted ?? false,
      trustRevision: entry.trustRevision ?? 0,
      temporary: false
    })) : [...committed.workspaces.values()];
    const publishedSessions = view ? view.sessions.map((entry) => ({
      id: entry.appSessionId,
      workspaceId: entry.workspaceId,
      title: entry.title ?? "Untitled session",
      status: entry.status,
      pinned: entry.pinned,
      archived: entry.archived,
      ...entry.parentSessionId && {
        parentSessionId: entry.parentSessionId
      }
    })) : [...committed.sessions.values()];
    if (w && !publishedWorkspaces.some((entry) => entry.id === w.id))
      w = void 0;
    if (s && (!w || !publishedSessions.some(
      (entry) => entry.id === s.id && entry.workspaceId === w.id
    )))
      s = void 0;
    if (observationSequence >= Number.MAX_SAFE_INTEGER) fail2("UNAVAILABLE");
    const recovery2 = recoveryDTO();
    const blocked = recovery2.store.state !== "ready";
    const selectedBlocked = recovery2.resources.some(
      (resource) => resource.workspaceId === w?.id && (!resource.sessionId || resource.sessionId === s?.id)
    );
    const projected = projection ?? nativeProjections.get(s?.id) ?? s;
    return validateSnapshot({
      runtimeEpoch: host.epoch,
      revision: registry2?.status().revision ?? revision,
      observationSequence: ++observationSequence,
      recovery: recovery2,
      retainedOperations: registry2?.readView().retainedOperations ?? [],
      state: blocked || initializing || selectedBlocked ? "unavailable" : runtime2?.snapshot().state ?? "unavailable",
      temporary: registry2 ? false : true,
      workspaces: publishedWorkspaces.map(
        ({ id: id3, name, path: path2, kind, trusted, trustRevision, temporary }) => ({
          id: id3,
          name,
          path: path2,
          kind,
          trusted,
          trustRevision,
          temporary
        })
      ),
      sessions: publishedSessions.map(
        ({
          id: id3,
          workspaceId,
          title,
          status,
          pinned,
          archived,
          parentSessionId
        }) => ({
          id: id3,
          workspaceId,
          title,
          status: blocked || recovery2.resources.some(
            (r) => r.workspaceId === workspaceId && (!r.sessionId || r.sessionId === id3)
          ) ? "unavailable" : nativeProjections.get(id3)?.status ?? status,
          pinned,
          archived,
          ...parentSessionId && { parentSessionId }
        })
      ),
      ...w && { selectedWorkspaceId: w.id },
      ...s && { selectedSessionId: s.id },
      messages: blocked || initializing || selectedBlocked || s?.unavailable ? [] : projected?.messages ?? [],
      permissions: blocked || initializing || selectedBlocked || s?.unavailable ? [] : projected?.permissions ?? [],
      ...projected?.error ? { error: projected.error } : s?.policyError ? {
        error: {
          code: "POLICY_UNVERIFIED",
          message: ERRORS.POLICY_UNVERIFIED
        }
      } : {}
    });
  }
  async function refresh(original) {
    const s = {
      ...original,
      receipts: new Map(original.receipts),
      invalidPermissions: new Set(original.invalidPermissions)
    };
    if (reads.has(s.id)) return reads.get(s.id);
    const generation = resourceGenerations.get(s.workspaceId) ?? 0;
    const currentResourceMatches = () => {
      const current = committed.sessions.get(s.id);
      return current && current.sdkId === original.sdkId && current.workspaceId === original.workspaceId && (resourceGenerations.get(s.workspaceId) ?? 0) === generation && current.generation === original.generation;
    };
    const read = (async () => {
      try {
        const info = await call(client.session.get, { sessionID: s.sdkId });
        const active = await call(client.session.active);
        const inbox = await call(client.session.inbox.list, {
          sessionID: s.sdkId
        });
        const messages = await call(client.message.list, {
          sessionID: s.sdkId,
          limit: 100,
          order: "desc"
        });
        const pending = await call(client.permission.list, {
          sessionID: s.sdkId
        });
        if (info?.id !== s.sdkId || await canonicalDirectory(info.location?.directory) !== workspace(s.workspaceId).path || !active || typeof active !== "object" || !Array.isArray(inbox) || !Array.isArray(messages?.data) || !Array.isArray(pending))
          fail2("RUNTIME_ERROR");
        checkLive();
        if ((resourceGenerations.get(s.workspaceId) ?? 0) !== generation || original.lock || !currentResourceMatches())
          fail2("READ_BUSY");
        s.messages = projectMessages([...messages.data].reverse());
        s.permissions = pending.filter(
          (p) => p.sessionID === s.sdkId && opaque(p.id) && !s.invalidPermissions.has(p.id)
        ).slice(0, 100).map((p) => ({
          id: p.id,
          sessionId: s.id,
          title: clip(p.action, 128),
          detail: clip(
            Array.isArray(p.resources) ? p.resources.filter((x) => typeof x === "string").join("\n") : "",
            2e3
          )
        }));
        const running = active[s.sdkId]?.type === "running" || inbox.some((item) => item.sessionID === s.sdkId);
        const observedReceipt = [...s.receipts.values()].some(
          (r) => r.inboxId && (inbox.some((i) => i.id === r.inboxId) || messages.data.some((m) => m.id === r.inboxId))
        );
        if (running)
          s.status = s.status === "stopping" ? "stopping" : "running";
        else if (!s.unknown && (!s.awaiting || observedReceipt || typeof info.time?.idle === "number" && info.time.idle >= s.awaiting)) {
          s.status = "idle";
          s.awaiting = void 0;
        } else s.status = s.unknown ? "unknown" : s.status;
        const latest = messages.data.find((m) => m.type === "assistant");
        const failed = latest?.error ? latest : void 0;
        const code = s.unknown ? "UNKNOWN_OUTCOME" : failed ? structuredError(failed.error) : info.outcome === "failed" ? "RUNTIME_ERROR" : void 0;
        s.error = code ? { code, message: ERRORS[code] } : void 0;
      } catch {
        checkLive();
        if ((resourceGenerations.get(s.workspaceId) ?? 0) !== generation || original.lock || !currentResourceMatches())
          fail2("READ_BUSY");
        if (!s.lock) {
          s.status = "unknown";
          s.error = { code: "RUNTIME_ERROR", message: ERRORS.RUNTIME_ERROR };
        }
      }
      checkLive();
      if (!currentResourceMatches() || (resourceGenerations.get(s.workspaceId) ?? 0) !== generation)
        fail2("READ_BUSY");
      nativeProjections.set(s.id, s);
      return s;
    })().finally(() => reads.delete(s.id));
    reads.set(s.id, read);
    return read;
  }
  async function catalog(w) {
    if (!w.trusted) return { dto: emptyCatalog(), models: /* @__PURE__ */ new Map() };
    await recheck(w);
    const location = { location: { directory: w.path } };
    const group = async (fn) => {
      try {
        const result = await call(fn, location);
        if (!Array.isArray(result?.data)) throw new Error();
        return result.data.slice(0, 300);
      } catch {
        checkLive();
        return null;
      }
    };
    const commands = await group(client.command?.list);
    const skills = await group(client.skill?.list);
    const mcp = await group(client.mcp?.list);
    const agents = await group(client.agent?.list);
    const models = await group(client.model?.list);
    const providers = await group(client.provider?.list);
    const integrations = await group(client.integration?.list);
    const simple = (items, key2 = "id") => items === null ? unavailable() : available(
      items.filter((i) => opaque(i[key2]) && typeof i.name === "string").map((i) => ({
        id: i[key2],
        name: clip(i.name, 256),
        ...typeof i.description === "string" ? { description: clip(i.description, 1e3) } : {}
      }))
    );
    const modelMap = /* @__PURE__ */ new Map();
    for (const model of models ?? []) {
      const provider = providers?.find(
        (p) => p.id === model.providerID && p.activation !== "disabled"
      );
      const integration = integrations?.find(
        (i) => i.id === provider?.integrationID
      );
      const authenticated = integration?.connections?.some(
        (c) => c.type === "credential" || c.type === "env"
      );
      if (model.enabled === true && opaque(model.id) && opaque(model.providerID) && provider && authenticated) {
        const id3 = createHash4("sha256").update(JSON.stringify([model.providerID, model.id])).digest("hex");
        modelMap.set(id3, model);
      }
    }
    return {
      models: modelMap,
      dto: {
        commands: simple(commands, "name"),
        skills: simple(skills),
        agents: simple(
          agents?.filter(
            (a) => !a.hidden && ["primary", "all"].includes(a.mode)
          ) ?? null
        ),
        mcp: mcp === null ? unavailable() : available(
          mcp.filter((i) => opaque(i.name)).map((i) => ({
            id: i.name,
            name: clip(i.name, 256),
            status: [
              "connected",
              "pending",
              "disabled",
              "failed",
              "needs_auth"
            ].includes(i.status?.status) ? i.status.status : "unavailable"
          }))
        ),
        models: models === null || providers === null || integrations === null ? unavailable() : available(
          [...modelMap].map(([id3, m]) => ({
            id: id3,
            name: clip(m.name, 256),
            status: clip(m.status, 32)
          }))
        )
      }
    };
  }
  async function send(request, w, s) {
    if (s.archived) fail2("ARCHIVED_SESSION");
    const hash3 = fingerprint(request);
    const receiptKey = currentScope()?.record?.operationId ?? request.requestId;
    const previous = s.receipts.get(receiptKey);
    if (previous) {
      if (previous.hash !== hash3) fail2("DUPLICATE_CONFLICT");
      return previous.result?.ok === false ? previous.result : {
        ok: true,
        value: {
          requestId: request.requestId,
          status: previous.unknown ? "unknown" : "duplicate"
        }
      };
    }
    if (w.lock || s.lock || s.status !== "idle" || s.unknown) fail2("BUSY");
    if (s.receipts.size >= 256) fail2("LIMIT_REACHED");
    const receipt = { hash: hash3 };
    s.receipts.set(receiptKey, receipt);
    s.lock = true;
    w.lock = true;
    s.generation++;
    let dispatched = false;
    let switching = false;
    try {
      await recheck(w);
      if (!w.trusted) fail2("INVALID_SELECTION");
      await policy(s, "native.policy.before_selection");
      const active = await call(client.session.active);
      const inbox = await call(client.session.inbox.list, {
        sessionID: s.sdkId
      });
      if (!active || typeof active !== "object" || !Array.isArray(inbox))
        fail2("RUNTIME_ERROR");
      if (active[s.sdkId] || inbox.some((item) => item.sessionID === s.sdkId)) {
        s.status = "running";
        fail2("BUSY");
      }
      const inventory = await catalog(w);
      if (!inventory.models.size) fail2("AUTH_REQUIRED");
      if (request.agent && !inventory.dto.agents.entries.some((a) => a.id === request.agent))
        fail2("INVALID_SELECTION");
      if (request.model && !inventory.models.has(request.model))
        fail2("INVALID_SELECTION");
      if (request.type === "command.run" && !inventory.dto.commands.entries.some((c) => c.id === request.name))
        fail2("INVALID_SELECTION");
      switching = true;
      if (request.agent)
        await call(client.session.switchAgent, {
          sessionID: s.sdkId,
          agent: request.agent
        });
      if (request.model) {
        const selected = inventory.models.get(request.model);
        await call(client.session.switchModel, {
          sessionID: s.sdkId,
          model: { id: selected.id, providerID: selected.providerID }
        });
      }
      await policy(s, "native.policy.after_selection");
      switching = false;
      await recheck(w);
      s.status = "running";
      s.awaiting = Date.now();
      dispatched = true;
      if (request.type === "message.send") {
        const result = await call(client.session.prompt, {
          sessionID: s.sdkId,
          text: request.text
        });
        if (!opaque(result?.id) || result.sessionID !== s.sdkId || result.type !== "user" || result.payload?.text !== request.text)
          throw new Error("invalid_receipt");
        receipt.inboxId = result.id;
      } else
        await call(client.session.command, {
          sessionID: s.sdkId,
          name: request.name,
          text: request.arguments
        });
      receipt.result = {
        ok: true,
        value: { requestId: request.requestId, status: "accepted" }
      };
    } catch (error) {
      if (dispatched) {
        s.unknown = true;
        s.status = "unknown";
        receipt.unknown = true;
        receipt.result = {
          ok: true,
          value: { requestId: request.requestId, status: "unknown" }
        };
      } else {
        if (switching && error.appCode !== "POLICY_UNVERIFIED") {
          s.unknown = true;
          s.status = "unknown";
        }
        receipt.result = failure(error.appCode ?? "RUNTIME_ERROR");
      }
    } finally {
      s.lock = false;
      w.lock = false;
      s.generation++;
      if (!currentScope()?.candidate) revision++;
    }
    return receipt.result;
  }
  function successor(w) {
    return [...tables().sessions.values()].find(
      (item) => item.workspaceId === w.id && !item.archived
    );
  }
  function safeSnapshot(w, preferred) {
    if (!w || tables().workspaces.get(w.id) !== w) return base();
    const selected = preferred && tables().sessions.get(preferred.id) === preferred && !preferred.archived ? preferred : successor(w);
    return base(w, selected);
  }
  async function idleIdentity(w, s) {
    await recheck(w);
    if (tables().sessions.get(s.id) !== s || s.workspaceId !== w.id)
      fail2("NOT_FOUND");
    if (s.unknown || s.status !== "idle" || s.awaiting) fail2("BUSY");
    const info = await call(client.session.get, { sessionID: s.sdkId });
    const active = await call(client.session.active);
    const inbox = await call(client.session.inbox.list, { sessionID: s.sdkId });
    if (info?.id !== s.sdkId || await canonicalDirectory(info.location?.directory) !== w.path || !active || typeof active !== "object" || Array.isArray(active) || !Array.isArray(inbox))
      fail2("RUNTIME_ERROR");
    await recheck(w);
    if (tables().sessions.get(s.id) !== s) fail2("NOT_FOUND");
    if (active[s.sdkId] || inbox.length || s.unknown || s.status !== "idle" || s.awaiting)
      fail2("BUSY");
    return info;
  }
  async function scanSessions(input, visit, code) {
    const seen = /* @__PURE__ */ new Set();
    let cursor;
    try {
      for (let page = 0; page < 100; page++) {
        const result = await call(client.session.list, {
          ...input,
          limit: 100,
          ...cursor && { cursor }
        });
        if (!result || !Array.isArray(result.data) || result.data.length > 100 || !result.cursor || typeof result.cursor !== "object" || Array.isArray(result.cursor) || result.data.some((item) => !opaque(item?.id)))
          fail2(code);
        const next = result.cursor.next;
        if (next !== void 0 && next !== null && (typeof next !== "string" || !next.length || next.length > 8192 || [...next].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
        ) || seen.has(next)))
          fail2(code);
        visit(result.data);
        if (next === void 0 || next === null) return;
        seen.add(next);
        cursor = next;
      }
      fail2(code);
    } catch (error) {
      if (error.appCode === "HAS_DESCENDANTS") throw error;
      fail2(code);
    }
  }
  async function noDescendants(s) {
    if ([...tables().sessions.values()].some(
      (item) => item.parentSessionId === s.id
    ))
      fail2("HAS_DESCENDANTS");
    await scanSessions(
      {},
      (data) => {
        for (const item of data) {
          if (item.parentID != null && !opaque(item.parentID) || item.fork != null && (typeof item.fork !== "object" || Array.isArray(item.fork) || !opaque(item.fork.sessionID)))
            fail2("DESCENDANTS_UNVERIFIED");
          if (item.parentID === s.sdkId || item.fork?.sessionID === s.sdkId)
            fail2("HAS_DESCENDANTS");
        }
      },
      "DESCENDANTS_UNVERIFIED"
    );
  }
  async function verifyRemoved(s) {
    try {
      const info = await call(client.session.get, { sessionID: s.sdkId });
      if (info?.id === s.sdkId) fail2("UNKNOWN_OUTCOME");
    } catch (error) {
      if (error?._tag === "SessionNotFoundError" && error.sessionID === s.sdkId && typeof error.message === "string")
        return;
      if (error.appCode === "UNKNOWN_OUTCOME") throw error;
    }
    await scanSessions(
      {},
      (data) => {
        if (data.some((item) => item.id === s.sdkId)) fail2("UNKNOWN_OUTCOME");
      },
      "UNKNOWN_OUTCOME"
    );
  }
  async function lifecycle(request) {
    const hash3 = fingerprint(request);
    const receiptKey = currentScope()?.record?.operationId ?? request.requestId;
    const prior = lifecycleReceipts.get(receiptKey);
    if (prior) {
      if (prior.hash !== hash3) fail2("DUPLICATE_CONFLICT");
      if (!prior.result) fail2("BUSY");
      if (!prior.result.ok) return prior.result;
      return {
        ok: true,
        value: safeSnapshot(
          tables().workspaces.get(request.workspaceId),
          tables().sessions.get(prior.selectedSessionId)
        )
      };
    }
    const w = workspace(request.workspaceId);
    const s = session(w.id, request.sessionId);
    if (lifecycleReceipts.size >= 2048) fail2("LIMIT_REACHED");
    const receipt = { hash: hash3 };
    lifecycleReceipts.set(receiptKey, receipt);
    const started = performance2.now();
    let locked = false;
    let dispatched = false;
    let child;
    try {
      if (w.lock || s.lock || s.status !== "idle" || s.unknown || s.awaiting || [...tables().sessions.values()].some(
        (item) => item.workspaceId === w.id && item.lock
      ))
        fail2("BUSY");
      w.lock = true;
      s.lock = true;
      locked = true;
      s.generation++;
      await idleIdentity(w, s);
      if (request.type === "session.rename") {
        dispatched = true;
        await call(client.session.update, {
          sessionID: s.sdkId,
          title: request.title
        });
        const updated = await idleIdentity(w, s);
        if (updated.title !== request.title) fail2("UNKNOWN_OUTCOME");
        s.title = request.title;
      } else if (request.type === "session.pin") {
        await markEffect();
        s.pinned = request.pinned;
      } else if (request.type === "session.archive") {
        await markEffect();
        s.archived = request.archived;
      } else if (request.type === "session.fork") {
        if (!w.trusted) fail2("INVALID_SELECTION");
        if (tables().sessions.size >= 200) fail2("LIMIT_REACHED");
        await reserveSession(w, void 0, void 0, void 0, true);
        dispatched = true;
        let forked;
        try {
          forked = await call(client.session.fork, { sessionID: s.sdkId });
        } catch (error) {
          if (error?._tag === "InvalidRequestError" && error.kind === "empty_session") {
            dispatched = false;
            const record = currentScope()?.record;
            if (record) {
              record.verifiedNone = true;
              record.evidence = [
                { kind: "native-rejected-empty", id: s.sdkId }
              ];
            }
            fail2("EMPTY_SESSION");
          }
          throw error;
        }
        child = await addSession(w, forked);
        child.parentSessionId = s.id;
        child.archived = true;
        child.unknown = true;
        child.status = "unknown";
        await policy(child);
        if (request.title)
          await call(client.session.update, {
            sessionID: child.sdkId,
            title: request.title
          });
        const checked = await call(client.session.get, {
          sessionID: child.sdkId
        });
        if (checked?.id !== child.sdkId || await canonicalDirectory(checked.location?.directory) !== w.path || !policyMatches(checked.permissions) || request.title && checked.title !== request.title)
          fail2("UNKNOWN_OUTCOME");
        await idleIdentity(w, s);
        child.title = clip(checked.title, 256) || child.title;
        child.archived = false;
        child.unknown = false;
        child.status = "idle";
      } else if (request.type === "session.remove") {
        await noDescendants(s);
        const info = await idleIdentity(w, s);
        if (!registry2) await markEffect();
        if (!await confirmSessionRemoval({
          title: clip(info.title, 256) || s.title,
          workspaceName: w.name,
          path: w.path
        }))
          fail2("CANCELLED");
        await idleIdentity(w, s);
        await noDescendants(s);
        await idleIdentity(w, s);
        dispatched = true;
        await call(client.session.remove, { sessionID: s.sdkId });
        await verifyRemoved(s);
        tables().sessions.delete(s.id);
      }
      const selected = child ?? (tables().sessions.has(s.id) && !s.archived ? s : successor(w));
      defaultWorkspace = w.id;
      defaultSession = selected?.id;
      receipt.selectedSessionId = selected?.id;
      receipt.result = { ok: true, value: safeSnapshot(w, selected) };
    } catch (error) {
      if (dispatched) {
        s.unknown = true;
        s.status = "unknown";
        if (child) {
          child.unknown = true;
          child.status = "unknown";
          child.archived = true;
        }
        receipt.result = failure("UNKNOWN_OUTCOME");
      } else
        receipt.result = failure(
          Object.hasOwn(ERRORS, error.appCode) ? error.appCode : "RUNTIME_ERROR"
        );
    } finally {
      if (locked) {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
      const result = receipt.result;
      observe(request, result, started, { workspaceId: w.id, sessionId: s.id });
      if (result.ok) receipt.result = { ok: true };
    }
    return receipt.result.ok ? {
      ok: true,
      value: safeSnapshot(
        w,
        tables().sessions.get(receipt.selectedSessionId)
      )
    } : receipt.result;
  }
  async function execute(request) {
    if (request.type === "snapshot" && registryInput !== void 0 && (initializing || localRecovery || registry2?.status().state === "recovery_required")) {
      await registryLoaded;
      const w2 = request.workspaceId ? workspace(request.workspaceId) : committed.workspaces.get(defaultWorkspace);
      const s2 = request.sessionId ? session(request.workspaceId, request.sessionId) : committed.sessions.get(defaultSession);
      return base(w2, s2);
    }
    if (request.type !== "diagnostics.list") await ready2;
    checkLive();
    if (request.type !== "snapshot" && request.type !== "diagnostics.list" && registry2) {
      storageCheck();
      if (recoveryDTO().resources.some(
        (r) => r.workspaceId === request.workspaceId && (r.reason !== "unresolved_operation" || !mutationTypes.has(request.type))
      ))
        fail2("UNAVAILABLE");
    }
    if (lifecycleTypes.has(request.type)) return lifecycle(request);
    const w = request.workspaceId ? workspace(request.workspaceId) : void 0;
    const s = request.sessionId ? session(request.workspaceId, request.sessionId) : void 0;
    if (request.type === "diagnostics.list")
      return {
        ...diagnostics,
        events: diagnostics.events.filter(
          (event) => (!w || event.workspaceId === w.id) && (!s || event.sessionId === s.id)
        ).map((event) => ({ ...event }))
      };
    if (request.type === "snapshot") {
      const selectedW = w ?? tables().workspaces.get(defaultWorkspace);
      const selectedS = s ?? (w ? [...tables().sessions.values()].find(
        (item) => item.workspaceId === w.id && !item.archived
      ) : tables().sessions.get(defaultSession));
      const projection = selectedS && !selectedS.unavailable && !recoveryDTO().resources.some(
        (r) => r.workspaceId === selectedS.workspaceId
      ) ? await refresh(selectedS) : void 0;
      return base(selectedW, selectedS, projection);
    }
    if (request.type === "workspace.import" || request.type === "workspace.create") {
      if (tables().workspaces.size >= 100) fail2("LIMIT_REACHED");
      if (request.name?.trim() && !portableName(request.name))
        fail2("INVALID_REQUEST");
      if (registry2 && request.type === "workspace.create") {
        const reservation2 = await reserveSession(
          void 0,
          "managed",
          void 0,
          request.name
        );
        await registry2.materializeManaged(operationKey3(currentScope().record));
        currentScope().effectStarted = true;
        const created = addWorkspace(
          reservation2.workspace.canonicalPath,
          false,
          false,
          reservation2
        );
        return base(created);
      }
      if (!registry2) await markEffect();
      const picked = await pickDirectory();
      checkLive();
      if (!picked) fail2("CANCELLED");
      if (!registry2) await markEffect();
      const path2 = request.type === "workspace.create" ? await createFolder(picked, request.name) : await canonicalDirectory(picked);
      const reservation = registry2 ? await reserveSession(void 0, "imported", path2) : void 0;
      if (registry2) await markEffect();
      return base(addWorkspace(path2, false, false, reservation));
    }
    if (request.type === "workspace.remove") {
      if (w.lock || [...tables().sessions.values()].some(
        (item) => item.workspaceId === w.id && (item.lock || item.status !== "idle" || item.unknown)
      ))
        fail2("BUSY");
      await markEffect("registry.unregister");
      const record = currentScope()?.record;
      if (record)
        record.removedSessionIds = [...tables().sessions.values()].filter((item) => item.workspaceId === w.id).map((item) => item.id);
      for (const item of tables().sessions.values())
        if (item.workspaceId === w.id) {
          tables().sessions.delete(item.id);
          item.generation++;
        }
      tables().workspaces.delete(w.id);
      return base();
    }
    if (request.type === "session.create") {
      if (w.lock) fail2("BUSY");
      if (tables().sessions.size >= 200) fail2("LIMIT_REACHED");
      w.lock = true;
      try {
        await reserveSession(w);
        await recheck(w);
        if (!w.trusted) {
          if (!registry2) await markEffect();
          if (!await confirmTrust(w.path)) fail2("CANCELLED");
          await recheck(w);
          if (!registry2) await markEffect();
          w.trusted = true;
          w.trustRevision++;
        }
        const info = await call(client.session.create, {
          ...registry2 && {
            id: currentScope().reservation.plannedNativeSessionId,
            metadata: currentScope().nativeMetadata
          },
          title: request.title || "Untitled session",
          location: { directory: w.path },
          permissions: BASELINE_POLICY.map((rule) => ({ ...rule }))
        });
        const checked = registry2 ? await call(client.session.get, { sessionID: info.id }) : info;
        const created = await addSession(w, checked);
        await policy(created);
        return base(w, created);
      } finally {
        w.lock = false;
      }
    }
    if (request.type === "catalog.list") return (await catalog(w)).dto;
    if (request.type === "file.list" || request.type === "file.read") {
      await recheck(w);
      try {
        return request.type === "file.list" ? await listFiles(w.path, request.path) : await readFilePreview(w.path, request.path);
      } catch (error) {
        fail2(error.appCode ?? "FILE_DENIED");
      }
    }
    if (request.type === "message.send" || request.type === "command.run")
      return send(request, w, s);
    if (request.type === "session.interrupt") {
      if (w.lock || s.lock) fail2("BUSY");
      w.lock = true;
      s.lock = true;
      s.generation++;
      try {
        const acknowledgement = await call(client.session.interrupt, {
          sessionID: s.sdkId
        });
        if (acknowledgement?.interrupted !== true) fail2("UNKNOWN_OUTCOME");
        s.status = "stopping";
        return { status: "stopping" };
      } catch {
        s.unknown = true;
        s.status = "unknown";
        return { status: "unknown" };
      } finally {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
    }
    if (request.type === "permission.respond") {
      if (w.lock || s.lock) fail2("BUSY");
      w.lock = true;
      s.lock = true;
      s.generation++;
      try {
        const pending = await call(client.permission.list, {
          sessionID: s.sdkId
        });
        if (!Array.isArray(pending) || s.invalidPermissions.has(request.requestId) || !pending.some(
          (p) => p.id === request.requestId && p.sessionID === s.sdkId
        ))
          fail2("STALE_PERMISSION");
        if (s.invalidPermissions.size + pending.length > 2048)
          fail2("LIMIT_REACHED");
        await markEffect();
        for (const p of pending)
          if (p.sessionID === s.sdkId && (request.decision === "reject" || p.id === request.requestId))
            s.invalidPermissions.add(p.id);
        s.permissions = [];
        try {
          await call(client.permission.reply, {
            sessionID: s.sdkId,
            requestID: request.requestId,
            decision: request.decision
          });
          return { requestId: request.requestId, status: "decided" };
        } catch {
          s.unknown = true;
          s.status = "unknown";
          return { requestId: request.requestId, status: "unknown" };
        }
      } finally {
        w.lock = false;
        s.lock = false;
        s.generation++;
      }
    }
    fail2("INVALID_REQUEST");
  }
  async function handleRequest(value) {
    let request;
    let owned;
    let result;
    const started = performance2.now();
    try {
      request = validateRequest(value);
      if (request.type !== "snapshot" && request.type !== "diagnostics.list")
        await ready2;
      if (mutationTypes.has(request.type)) {
        storageCheck();
        if (currentScope().kind !== "trusted")
          currentScope().candidate = cloneTables();
        if (request.workspaceId)
          resourceGenerations.set(
            request.workspaceId,
            (resourceGenerations.get(request.workspaceId) ?? 0) + 1
          );
      }
      checkLive();
      const w = tables().workspaces.get(request.workspaceId);
      const s = tables().sessions.get(request.sessionId);
      if ((!request.workspaceId || w) && (!request.sessionId || s && s.workspaceId === w?.id))
        owned = {
          ...w && { workspaceId: w.id },
          ...s && { sessionId: s.id }
        };
      const executed = await execute(request);
      result = lifecycleTypes.has(request.type) || request.type === "message.send" || request.type === "command.run" ? executed : { ok: true, value: executed };
    } catch (error) {
      result = failure(
        Object.hasOwn(ERRORS, error.appCode) ? error.appCode : "RUNTIME_ERROR"
      );
    }
    if (owned && mutationTypes.has(request?.type) && !lifecycleTypes.has(request.type) && result.value?.status !== "duplicate")
      observe(request, result, started, owned);
    return result;
  }
  return {
    handle(value, sender) {
      if (trustedTestAdapter && sender === void 0 && registryInput !== void 0)
        return Promise.resolve(failure("INVALID_REQUEST"));
      if (trustedTestAdapter && sender === void 0)
        return host.trusted(async () => {
          const result = await handleRequest(value);
          if (currentScope().candidate) {
            committed = currentScope().candidate;
            currentScope().candidate = void 0;
          }
          return result;
        });
      return host.handle(value, sender);
    },
    drain: () => host.drain(),
    cancelRead: (value, sender) => host.cancel(value, sender),
    closeSender: (sender) => host.closeSender(sender),
    close() {
      controller.abort();
      host.close();
    }
  };
}

// apps/desktop-app/src/host/workbench-ipc.mjs
function bindWorkbenchIpc({ ipcMain: ipcMain2, admit: admit2, service }) {
  ipcMain2.handle("desktop:v2:workbench", (event, ...args) => {
    if (!admit2(event) || args.length !== 1) return failure("INVALID_REQUEST");
    return service()?.handle(args[0], String(event.sender.id)) ?? failure("UNAVAILABLE");
  });
  ipcMain2.handle("desktop:v2:cancel-read", (event, ...args) => {
    if (!admit2(event) || args.length !== 1) return failure("INVALID_REQUEST");
    return service()?.cancelRead(args[0], String(event.sender.id)) ?? failure("UNAVAILABLE");
  });
}

// apps/desktop-app/src/host/storage-lock.mjs
import * as fs from "node:fs/promises";
import { constants as constants3 } from "node:fs";
import { createHash as createHash5, randomUUID as randomUUID4 } from "node:crypto";
import { join as join6, isAbsolute as isAbsolute7 } from "node:path";
var VERSION2 = 5;
var MAX_BYTES = 16384;
var token = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(v);
var exact = (v, keys2) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys2.length && keys2.every((k) => Object.hasOwn(v, k));
var identityKeys = ["pid", "platform", "bootId", "startToken"];
function validIdentity(v) {
  return exact(v, identityKeys) && Number.isSafeInteger(v.pid) && v.pid > 0 && ["darwin", "linux", "win32"].includes(v.platform) && token(v.bootId) && token(v.startToken);
}
function sameIdentity(a, b) {
  return validIdentity(a) && validIdentity(b) && identityKeys.every((k) => a[k] === b[k]);
}
var ready = () => Object.freeze({ state: "ready" });
var recovery = (reason) => Object.freeze({ state: "recovery_required", reason });
var hash = (value) => createHash5("sha256").update(JSON.stringify(value)).digest("hex");
function payload(r) {
  return Object.fromEntries(["version", "root", "rootIdentity", "nonce", "app", "child", "spawnIntent", "childExitConfirmed", "cleanShutdown"].map((k) => [k, r[k]]));
}
function validRecord(r) {
  return exact(r, [...Object.keys(payload({})), "checksum"]) && r.version === VERSION2 && typeof r.root === "string" && isAbsolute7(r.root) && /^[0-9]+:[0-9]+$/.test(r.rootIdentity) && token(r.nonce) && validIdentity(r.app) && (r.child === null || validIdentity(r.child) && !sameIdentity(r.child, r.app) && r.child.platform === r.app.platform && r.child.bootId === r.app.bootId) && typeof r.spawnIntent === "boolean" && typeof r.childExitConfirmed === "boolean" && typeof r.cleanShutdown === "boolean" && r.checksum === hash(payload(r)) && (!r.child || r.spawnIntent) && (!r.childExitConfirmed || r.child !== null) && (!r.cleanShutdown || !r.spawnIntent || r.child !== null && r.childExitConfirmed);
}
function createProcessVerifier({ captureCurrent, inspect } = {}) {
  return Object.freeze({
    async currentIdentity() {
      try {
        const value = await captureCurrent?.();
        return validIdentity(value) ? Object.freeze({ ...value }) : null;
      } catch {
        return null;
      }
    },
    async verify(expected) {
      if (!validIdentity(expected)) return "unverified";
      try {
        const result = await inspect?.(Object.freeze({ ...expected }));
        if (result?.state === "identity_conflict") return "identity_conflict";
        if (!sameIdentity(result?.identity, expected)) return "unverified";
        if (!["os_identity", "owned_exit"].includes(result.evidence)) return "unverified";
        if (result.evidence === "owned_exit" && result.state !== "exited") return "unverified";
        return ["alive", "exited"].includes(result.state) ? result.state : "unverified";
      } catch {
        return "unverified";
      }
    }
  });
}
function createElectronOwnerKernel(app2) {
  let root = null;
  let held = false;
  return Object.freeze({
    acquire(canonicalRoot) {
      if (root !== null) return root === canonicalRoot && held && app2.hasSingleInstanceLock();
      if (app2.hasSingleInstanceLock()) return false;
      root = canonicalRoot;
      app2.setPath("userData", canonicalRoot);
      held = app2.requestSingleInstanceLock();
      return held;
    },
    isHeld() {
      return held && app2.hasSingleInstanceLock();
    },
    release() {
      if (!held || !app2.hasSingleInstanceLock()) throw new Error("Owner unavailable");
      app2.releaseSingleInstanceLock();
      if (app2.hasSingleInstanceLock()) throw new Error("Owner release unconfirmed");
      held = false;
    }
  });
}
function createStorageOwner({ root, kernel: kernel2, processVerifier = createProcessVerifier(), io = fs, nonce = randomUUID4 } = {}) {
  let canonical;
  let rootIdentity;
  let record;
  let ownedNonce = null;
  let acquired = false;
  let attempted = false;
  let released = false;
  let shutdownPending = false;
  let state = recovery("owner_unverified");
  let lane = Promise.resolve();
  const serial = (fn) => {
    const next = lane.then(fn);
    lane = next.catch(() => {
    });
    return next;
  };
  const block = (reason) => {
    state = recovery(reason);
    return state;
  };
  const file = (name) => join6(canonical, name);
  async function syncDirectory() {
    const handle = await io.open(canonical, constants3.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async function readRecord() {
    const entry = await io.lstat(file("owner.json"));
    if (!entry.isFile() || entry.isSymbolicLink()) return { invalid: true };
    const handle = await io.open(file("owner.json"), constants3.O_RDONLY | constants3.O_NOFOLLOW);
    try {
      const stat2 = await handle.stat();
      if (!stat2.isFile() || stat2.size > MAX_BYTES || stat2.size === 0) return { invalid: true };
      if (process.platform !== "win32" && (stat2.mode & 63) !== 0) return { denied: true };
      const bytes = await handle.readFile("utf8");
      try {
        return { value: JSON.parse(bytes) };
      } catch {
        return { invalid: true };
      }
    } finally {
      await handle.close();
    }
  }
  async function exists(name) {
    try {
      await io.lstat(file(name));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  async function guard() {
    const handle = await io.open(file("owner.pending"), "wx", 384);
    try {
      await handle.writeFile(ownedNonce);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory();
  }
  async function persist(candidate) {
    const next = payload(candidate);
    next.checksum = hash(next);
    try {
      await guard();
      const handle = await io.open(file("owner.next"), "wx", 384);
      try {
        await handle.writeFile(`${JSON.stringify(next)}
`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await io.rename(file("owner.next"), file("owner.json"));
      await syncDirectory();
      await io.unlink(file("owner.pending"));
      await syncDirectory();
      record = next;
      return ready();
    } catch {
      try {
        if (!await exists("owner.pending")) await guard();
      } catch {
      }
      return block("writer_poisoned");
    }
  }
  async function verify(identity) {
    try {
      const result = await processVerifier.verify(Object.freeze({ ...identity }));
      return ["alive", "exited", "identity_conflict"].includes(result) ? result : "unverified";
    } catch {
      return "unverified";
    }
  }
  async function check(n, teardown = false) {
    if (state.state !== "ready" && !(teardown && shutdownPending && state.reason === "owner_unverified")) return state;
    if (released || !acquired || n !== ownedNonce) return block("identity_conflict");
    try {
      if (!await kernel2.isHeld()) return block("owner_unverified");
      if (await io.realpath(root) !== canonical) return block("identity_conflict");
      const stat2 = await io.stat(canonical, { bigint: true });
      if (`${stat2.dev}:${stat2.ino}` !== rootIdentity) return block("identity_conflict");
      if (await exists("owner.pending") || await exists("owner.next")) return block("writer_poisoned");
      const saved = await readRecord();
      if (saved.denied) return block("storage_denied");
      if (saved.value?.version !== void 0 && saved.value.version !== VERSION2) return block("unsupported_version");
      if (!validRecord(saved.value)) return block("owner_unverified");
      if (saved.value.nonce !== ownedNonce || saved.value.checksum !== record.checksum) return block("identity_conflict");
      return ready();
    } catch {
      return block("owner_unverified");
    }
  }
  return Object.freeze({
    status: () => state,
    getNonce: () => state.state === "ready" && !released ? ownedNonce : null,
    acquire: ({ initialize = false } = {}) => serial(async () => {
      if (attempted) return state;
      attempted = true;
      try {
        if (typeof root !== "string" || !isAbsolute7(root)) return block("storage_denied");
        canonical = await io.realpath(root);
        const stat2 = await io.stat(canonical, { bigint: true });
        if (!stat2.isDirectory() || process.platform !== "win32" && (stat2.mode & 0o022n) !== 0n) return block("storage_denied");
        rootIdentity = `${stat2.dev}:${stat2.ino}`;
        if (!await kernel2.acquire(canonical)) return block("owner_conflict");
        acquired = true;
        if (!await kernel2.isHeld()) return block("owner_unverified");
        if (await exists("owner.pending") || await exists("owner.next")) return block("writer_poisoned");
        let old;
        try {
          const saved = await readRecord();
          if (saved.denied) return block("storage_denied");
          if (saved.value?.version !== void 0 && saved.value.version !== VERSION2) return block("unsupported_version");
          if (!validRecord(saved.value)) return block("owner_unverified");
          old = saved.value;
        } catch (error) {
          if (error.code !== "ENOENT") return block("storage_denied");
          const allowed = /* @__PURE__ */ new Set(["SingletonLock", "SingletonCookie", "SingletonSocket"]);
          if (!initialize || (await io.readdir(canonical)).some((name) => !allowed.has(name))) return block("owner_unverified");
        }
        if (old) {
          if (old.root !== canonical || old.rootIdentity !== rootIdentity) return block("identity_conflict");
          for (const prior of [old.app, ...old.child ? [old.child] : []]) {
            const result2 = await verify(prior);
            if (result2 !== "exited") return block(result2 === "identity_conflict" ? "identity_conflict" : "owner_unverified");
          }
          if (old.spawnIntent && old.child === null) return block("owner_unverified");
        }
        const appIdentity = await processVerifier.currentIdentity();
        if (!validIdentity(appIdentity) || await verify(appIdentity) !== "alive") return block("owner_unverified");
        ownedNonce = nonce();
        if (!token(ownedNonce) || ownedNonce === old?.nonce) return block("identity_conflict");
        const candidate = {
          version: VERSION2,
          root: canonical,
          rootIdentity,
          nonce: ownedNonce,
          app: { ...appIdentity },
          child: null,
          spawnIntent: false,
          childExitConfirmed: false,
          cleanShutdown: false
        };
        const result = await persist(candidate);
        if (result.reason === "writer_poisoned") return result;
        state = ready();
        return state;
      } catch {
        return block("storage_denied");
      }
    }),
    assertOwned: (n) => serial(() => check(n)),
    markSpawnIntent: (n) => serial(async () => {
      if ((await check(n)).state !== "ready") return state;
      if (record.spawnIntent) return block("owner_unverified");
      return persist({ ...record, spawnIntent: true });
    }),
    recordChild: (n, child) => serial(async () => {
      if ((await check(n)).state !== "ready") return state;
      if (!record.spawnIntent || record.child || !validIdentity(child) || sameIdentity(child, record.app) || child.platform !== record.app.platform || child.bootId !== record.app.bootId) return block("identity_conflict");
      const frozenChild = { ...child };
      const result = await verify(frozenChild);
      if (!["alive", "exited"].includes(result)) return block(result === "identity_conflict" ? "identity_conflict" : "owner_unverified");
      return persist({ ...record, child: frozenChild });
    }),
    release: (n) => serial(async () => {
      if ((await check(n, true)).state !== "ready") return state;
      if (record.spawnIntent && !record.child) return block("owner_unverified");
      if (record.child) {
        const result = await verify(record.child);
        if (result !== "exited") {
          shutdownPending = result !== "identity_conflict";
          return block(result === "identity_conflict" ? "identity_conflict" : "owner_unverified");
        }
      }
      shutdownPending = true;
      if ((await persist({ ...record, childExitConfirmed: record.child !== null, cleanShutdown: true })).state !== "ready") return state;
      try {
        await kernel2.release();
        if (await kernel2.isHeld()) return block("owner_unverified");
      } catch {
        return block("owner_unverified");
      }
      released = true;
      ownedNonce = null;
      block("owner_unverified");
      return Object.freeze({ released: true });
    })
  });
}

// apps/desktop-app/src/host/workspace-registry.mjs
import * as fs3 from "node:fs/promises";
import { isDeepStrictEqual as isDeepStrictEqual2 } from "node:util";
import { randomUUID as randomUUID5 } from "node:crypto";
import { isAbsolute as isAbsolute9, join as join8, resolve as resolve3, parse, relative as relative6, sep as sep3 } from "node:path";

// apps/desktop-app/src/host/storage-journal.mjs
import * as fs2 from "node:fs/promises";
import { constants as constants4 } from "node:fs";
import { createHash as createHash6 } from "node:crypto";
import { isAbsolute as isAbsolute8, join as join7, resolve as resolve2 } from "node:path";
var STORAGE_LIMITS = Object.freeze({
  recordBytes: 4 * 1024 * 1024,
  operations: 2048,
  workspaces: 100,
  sessions: 200
});
var STORE_RECOVERY_REASONS2 = Object.freeze([
  "owner_conflict",
  "owner_unverified",
  "corrupt_journal",
  "unsupported_version",
  "identity_conflict",
  "unconfirmed_tail",
  "writer_poisoned",
  "pending_inbox",
  "native_startup_unverified",
  "storage_denied",
  "retained_limit"
]);
var RESOURCE_RECOVERY_REASONS2 = Object.freeze([
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation"
]);
var mutations = /* @__PURE__ */ new Set([
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove",
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "session.interrupt",
  "permission.respond",
  "command.run"
]);
var DISPATCH_STEPS = Object.freeze([
  "native.create",
  "native.fork",
  "native.remove",
  "native.rename",
  "native.pin",
  "native.archive",
  "native.metadata",
  "native.send",
  "native.command",
  "native.interrupt",
  "native.permission",
  "native.policy",
  "native.policy.before_selection",
  "native.policy.after_selection",
  "native.agent",
  "native.model",
  "registry.metadata",
  "registry.unregister",
  "filesystem.managed_base",
  "filesystem.managed_folder"
]);
var zeroHash = "0".repeat(64);
var clone = (value) => JSON.parse(JSON.stringify(value));
var hash2 = (value) => createHash6("sha256").update(JSON.stringify(value)).digest("hex");
function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function need(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
function closed3(value, required, optional = []) {
  need(
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
  need(
    required.every((key2) => Object.hasOwn(value, key2)) && Object.keys(value).every(
      (key2) => [...required, ...optional].includes(key2)
    )
  );
}
var integer = (value) => Number.isSafeInteger(value) && value >= 0;
var digest2 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var id2 = (value) => validWireId(value);
var resourceId2 = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
var displayText = (value) => ![...value].some(
  (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
);
var path = (value) => typeof value === "string" && value.length <= 4096 && !value.includes("\0") && isAbsolute8(value) && resolve2(value) === value;
function optionalIds(value, names) {
  for (const name of names)
    if (Object.hasOwn(value, name)) need(resourceId2(value[name]));
}
function validateStorageIdentity(value) {
  closed3(
    value,
    ["runtimeEpoch", "operationId", "type", "digest"],
    ["workspaceId", "sessionId"]
  );
  need(
    id2(value.runtimeEpoch) && id2(value.operationId) && mutations.has(value.type) && digest2(value.digest)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  return clone(value);
}
function validateStorageReceipt(value) {
  closed3(
    value,
    [
      "runtimeEpoch",
      "operationId",
      "type",
      "admission",
      "delivery",
      "effect",
      "revision",
      "evidence"
    ],
    ["workspaceId", "sessionId", "result"]
  );
  need(
    id2(value.runtimeEpoch) && id2(value.operationId) && mutations.has(value.type) && integer(value.revision)
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  need(["admitted", "dispatched", "rejected"].includes(value.admission));
  need(
    ["pending", "accepted", "unknown"].includes(value.delivery) && ["none", "pending", "confirmed", "unknown"].includes(value.effect)
  );
  need(Array.isArray(value.evidence) && value.evidence.length <= 8);
  for (const entry of value.evidence) {
    closed3(entry, ["kind"], ["id"]);
    need(resourceId2(entry.kind));
    optionalIds(entry, ["id"]);
  }
  if (Object.hasOwn(value, "result")) {
    const result = value.result;
    need(result !== null && typeof result === "object");
    const shapes = {
      created: [
        ["kind", "workspaceId"],
        ["sessionId", "nativeSessionId"]
      ],
      forked: [["kind", "workspaceId", "sessionId", "nativeSessionId"], []],
      removed: [
        ["kind", "workspaceId", "workspaceRemoved"],
        ["removedSessionIds"]
      ],
      metadata: [["kind", "workspaceId", "sessionId"], []],
      delivery: [
        ["kind", "status"],
        ["nativeInboxId", "nativeRequestId"]
      ],
      rejected: [["kind", "code"], []]
    };
    need(Object.hasOwn(shapes, result.kind));
    closed3(result, ...shapes[result.kind]);
    optionalIds(result, [
      "workspaceId",
      "sessionId",
      "nativeSessionId",
      "nativeInboxId",
      "nativeRequestId"
    ]);
    if (result.kind === "removed") {
      need(typeof result.workspaceRemoved === "boolean");
      if (Object.hasOwn(result, "removedSessionIds"))
        need(
          Array.isArray(result.removedSessionIds) && result.removedSessionIds.length <= 200 && result.removedSessionIds.every(resourceId2) && new Set(result.removedSessionIds).size === result.removedSessionIds.length
        );
    }
    if (result.kind === "delivery")
      need(["accepted", "stopping", "decided"].includes(result.status));
    if (result.kind === "rejected") need(Object.hasOwn(ERRORS, result.code));
  }
  return clone(value);
}
function validateRegistryDelta(value) {
  closed3(value, ["workspaces", "sessions", "tombstones"]);
  need(
    Array.isArray(value.workspaces) && value.workspaces.length <= 100 && Array.isArray(value.sessions) && value.sessions.length <= 200 && Array.isArray(value.tombstones) && value.tombstones.length <= 300
  );
  for (const workspace of value.workspaces) {
    closed3(
      workspace,
      ["workspaceId", "ownership", "canonicalPath", "registrationState"],
      ["folderSessionId", "name", "trustRevision", "storageGeneration"]
    );
    need(
      resourceId2(workspace.workspaceId) && ["managed", "imported", "legacy"].includes(workspace.ownership) && path(workspace.canonicalPath) && ["reserved", "registered", "unavailable"].includes(
        workspace.registrationState
      )
    );
    optionalIds(workspace, ["folderSessionId"]);
    if (workspace.ownership === "managed")
      need(
        typeof workspace.folderSessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          workspace.folderSessionId
        )
      );
    if (workspace.name !== void 0)
      need(
        typeof workspace.name === "string" && workspace.name.length <= 256 && displayText(workspace.name)
      );
    for (const key2 of ["trustRevision", "storageGeneration"])
      if (workspace[key2] !== void 0) need(integer(workspace[key2]));
  }
  for (const session of value.sessions) {
    closed3(
      session,
      ["appSessionId", "workspaceId", "lifecycleState", "pinned", "archived"],
      [
        "nativeSessionId",
        "parentSessionId",
        "title",
        "lastViewedAt",
        "recoveryReason"
      ]
    );
    need(
      resourceId2(session.appSessionId) && resourceId2(session.workspaceId) && ["reserved", "active", "unavailable"].includes(
        session.lifecycleState
      ) && typeof session.pinned === "boolean" && typeof session.archived === "boolean"
    );
    optionalIds(session, ["nativeSessionId", "parentSessionId"]);
    if (session.title !== void 0)
      need(
        typeof session.title === "string" && session.title.length <= 256 && displayText(session.title)
      );
    if (session.lastViewedAt !== void 0) need(integer(session.lastViewedAt));
    if (session.recoveryReason !== void 0)
      need(
        session.lifecycleState === "unavailable" && RESOURCE_RECOVERY_REASONS2.includes(session.recoveryReason)
      );
  }
  for (const entry of value.tombstones) {
    closed3(entry, ["kind", "id"]);
    need(["workspace", "session"].includes(entry.kind) && resourceId2(entry.id));
  }
  for (const [entries, key2] of [
    [value.workspaces, "workspaceId"],
    [value.sessions, "appSessionId"]
  ])
    need(
      new Set(entries.map((entry) => entry[key2])).size === entries.length,
      "identity_conflict"
    );
  need(
    new Set(
      value.tombstones.map((entry) => JSON.stringify([entry.kind, entry.id]))
    ).size === value.tombstones.length,
    "identity_conflict"
  );
  return clone(value);
}
function validateJournalPayload(value) {
  const common = ["kind", "revision"];
  need(
    value && typeof value.kind === "string" && integer(value.revision) && value.revision > 0
  );
  switch (value.kind) {
    case "admission":
      closed3(value, [...common, "identity"], ["rejectionCode"]);
      validateStorageIdentity(value.identity);
      if (value.rejectionCode !== void 0)
        need(Object.hasOwn(ERRORS, value.rejectionCode));
      break;
    case "reservation":
      closed3(
        value,
        [...common, "runtimeEpoch", "operationId", "workspace", "appSessionId"],
        ["plannedNativeSessionId"]
      );
      need(
        id2(value.runtimeEpoch) && id2(value.operationId) && resourceId2(value.appSessionId)
      );
      optionalIds(value, ["plannedNativeSessionId"]);
      validateRegistryDelta({
        workspaces: [value.workspace],
        sessions: [],
        tombstones: []
      });
      need(value.workspace.registrationState === "reserved");
      break;
    case "dispatch":
      closed3(
        value,
        [...common, "runtimeEpoch", "operationId", "step"],
        ["nativeSessionId"]
      );
      need(
        id2(value.runtimeEpoch) && id2(value.operationId) && DISPATCH_STEPS.includes(value.step)
      );
      optionalIds(value, ["nativeSessionId"]);
      break;
    case "completion":
      closed3(value, [
        ...common,
        "runtimeEpoch",
        "operationId",
        "receipt",
        "delta"
      ]);
      need(id2(value.runtimeEpoch) && id2(value.operationId));
      validateStorageReceipt(value.receipt);
      validateRegistryDelta(value.delta);
      need(
        value.receipt.runtimeEpoch === value.runtimeEpoch && value.receipt.operationId === value.operationId && value.receipt.revision === value.revision
      );
      break;
    case "owner_intent":
      closed3(value, [...common, "ownerNonce", "phase"], ["childId"]);
      need(
        id2(value.ownerNonce) && ["startup", "child_started", "shutdown"].includes(value.phase)
      );
      optionalIds(value, ["childId"]);
      break;
    case "migration_phase":
      closed3(value, [
        ...common,
        "migrationId",
        "sourceStoreId",
        "destinationStoreId",
        "phase",
        "inventoryHash"
      ]);
      need(
        id2(value.migrationId) && id2(value.sourceStoreId) && id2(value.destinationStoreId) && value.sourceStoreId !== value.destinationStoreId && [
          "retained",
          "quiesced",
          "copied",
          "verified",
          "cutover",
          "rollback"
        ].includes(value.phase) && digest2(value.inventoryHash)
      );
      break;
    case "recovery_decision":
      closed3(value, [...common, "action", "throughSequence", "throughHash"]);
      need(
        value.action === "adopt_validated_tail" && integer(value.throughSequence) && digest2(value.throughHash)
      );
      break;
    default:
      throw storageError("unsupported_version");
  }
  return clone(value);
}
var operationKey = (value) => JSON.stringify([value.runtimeEpoch, value.operationId]);
function historyValidator() {
  const operations = /* @__PURE__ */ new Map();
  const migrations = /* @__PURE__ */ new Map();
  let revision = 0;
  return (payload2) => {
    need(payload2.revision === revision + 1, "identity_conflict");
    const key2 = operationKey(payload2.identity ?? payload2);
    const prior = operations.get(key2);
    if (payload2.kind === "admission") {
      need(!prior, "identity_conflict");
      need(operations.size < STORAGE_LIMITS.operations, "retained_limit");
      operations.set(key2, {
        identity: payload2.identity,
        terminal: !!payload2.rejectionCode,
        reserved: false,
        steps: /* @__PURE__ */ new Set()
      });
    } else if (["reservation", "dispatch", "completion"].includes(payload2.kind)) {
      need(prior && !prior.terminal, "identity_conflict");
      if (payload2.kind === "reservation") {
        need(!prior.reserved, "identity_conflict");
        prior.reserved = true;
      }
      if (payload2.kind === "dispatch") {
        need(!prior.steps.has(payload2.step), "identity_conflict");
        prior.steps.add(payload2.step);
      }
      if (payload2.kind === "completion") {
        for (const field of [
          "runtimeEpoch",
          "operationId",
          "type",
          "workspaceId",
          "sessionId"
        ])
          need(
            payload2.receipt[field] === prior.identity[field],
            "identity_conflict"
          );
        need(
          payload2.receipt.effect !== "confirmed" || prior.steps.size > 0,
          "identity_conflict"
        );
        need(
          payload2.receipt.effect !== "none" || prior.steps.size === 0,
          "identity_conflict"
        );
        need(
          payload2.receipt.admission !== "rejected" || payload2.receipt.effect === "none",
          "identity_conflict"
        );
        prior.terminal = payload2.receipt.effect === "confirmed" || payload2.receipt.admission === "rejected";
      }
    } else if (payload2.kind === "migration_phase") {
      const priorMigration = migrations.get(payload2.migrationId);
      if (priorMigration)
        need(
          priorMigration.sourceStoreId === payload2.sourceStoreId && priorMigration.destinationStoreId === payload2.destinationStoreId && priorMigration.phase !== "rollback",
          "identity_conflict"
        );
      const transitions = {
        retained: ["quiesced", "rollback"],
        quiesced: ["copied", "rollback"],
        copied: ["verified", "rollback"],
        verified: ["cutover", "rollback"],
        cutover: ["rollback"]
      };
      need(
        priorMigration ? transitions[priorMigration.phase]?.includes(payload2.phase) : payload2.phase === "retained",
        "identity_conflict"
      );
      migrations.set(payload2.migrationId, payload2);
    }
    revision = payload2.revision;
  };
}
async function openStorageJournal({
  directory,
  storeId,
  io = {},
  recoveryReason
} = {}) {
  need(path(directory) && id2(storeId));
  if (recoveryReason !== void 0)
    need(STORE_RECOVERY_REASONS2.includes(recoveryReason));
  const adapter = {
    write: (file, bytes) => file.writeFile(bytes),
    syncFile: (file) => file.sync(),
    syncDirectory: async (directory2) => {
      const handle2 = await fs2.open(directory2, constants4.O_RDONLY);
      try {
        await handle2.sync();
      } finally {
        await handle2.close();
      }
    },
    rename: fs2.rename,
    unlink: fs2.unlink,
    ...io
  };
  const filename = join7(directory, "journal.jsonl");
  const current = join7(directory, "checkpoint.json");
  const previous = join7(directory, "checkpoint.previous.json");
  const pending = join7(directory, "checkpoint.pending.json");
  const temp = join7(directory, "checkpoint.tmp.json");
  let handle;
  let reason = recoveryReason;
  let closedWriter = false;
  let queue = Promise.resolve();
  let records = [];
  let committed = [];
  let checkpointGeneration = 0;
  let checkpointValue;
  let lastHash = zeroHash;
  let uncertainCheckpoint = false;
  try {
    const stat2 = await fs2.lstat(directory);
    need(stat2.isDirectory() && !stat2.isSymbolicLink(), "storage_denied");
    need(await fs2.realpath(directory) === directory, "storage_denied");
    for (const entry of [filename, current, previous, pending, temp]) {
      try {
        const stat3 = await fs2.lstat(entry);
        need(
          stat3.isFile() && !stat3.isSymbolicLink() && stat3.nlink === 1,
          "storage_denied"
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    let bytes;
    try {
      bytes = await fs2.readFile(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      bytes = Buffer.alloc(0);
    }
    const validateHistory = historyValidator();
    let offset = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset);
      try {
        need(
          end !== -1 && end - offset + 1 <= STORAGE_LIMITS.recordBytes,
          "corrupt_journal"
        );
        const line = bytes.subarray(offset, end);
        const decoded = line.toString("utf8");
        need(Buffer.from(decoded).equals(line), "corrupt_journal");
        const record = JSON.parse(decoded);
        closed3(record, [
          "schemaVersion",
          "storeId",
          "sequence",
          "previousHash",
          "payload",
          "checksum"
        ]);
        need(record.schemaVersion === 1, "unsupported_version");
        need(
          record.storeId === storeId && record.sequence === records.length + 1 && record.previousHash === lastHash,
          "identity_conflict"
        );
        const { checksum, ...body } = record;
        need(digest2(checksum) && hash2(body) === checksum, "corrupt_journal");
        validateJournalPayload(record.payload);
        if (record.payload.kind === "recovery_decision")
          need(
            record.payload.throughSequence === records.length && record.payload.throughHash === lastHash,
            "identity_conflict"
          );
        validateHistory(record.payload);
        records.push(record);
        lastHash = checksum;
        offset = end + 1;
      } catch (error) {
        reason = [
          "unsupported_version",
          "identity_conflict",
          "retained_limit"
        ].includes(error.code) ? error.code : "corrupt_journal";
        break;
      }
    }
    let ceiling = Infinity;
    try {
      const marker = JSON.parse(await fs2.readFile(pending, "utf8"));
      closed3(marker, ["schemaVersion", "storeId", "baseGeneration"]);
      need(
        marker.schemaVersion === 1 && marker.storeId === storeId && integer(marker.baseGeneration)
      );
      ceiling = marker.baseGeneration;
      uncertainCheckpoint = true;
    } catch (error) {
      if (error.code !== "ENOENT") {
        ceiling = 0;
        uncertainCheckpoint = true;
        reason ??= "corrupt_journal";
      }
    }
    const checkpoints = [];
    for (const entry of [current, previous]) {
      try {
        const candidate = JSON.parse(await fs2.readFile(entry, "utf8"));
        closed3(candidate, [
          "schemaVersion",
          "storeId",
          "generation",
          "sequence",
          "hash",
          "checksum"
        ]);
        need(candidate.schemaVersion === 1, "unsupported_version");
        const { checksum, ...body } = candidate;
        need(
          candidate.storeId === storeId && integer(candidate.generation) && candidate.generation > 0 && integer(candidate.sequence) && candidate.sequence <= records.length && candidate.hash === (candidate.sequence ? records[candidate.sequence - 1].checksum : zeroHash) && checksum === hash2(body),
          "corrupt_journal"
        );
        if (candidate.generation <= ceiling) checkpoints.push(candidate);
      } catch (error) {
        if (error.code !== "ENOENT")
          reason ??= error.code === "unsupported_version" ? "unsupported_version" : "corrupt_journal";
      }
    }
    checkpoints.sort((a, b) => b.generation - a.generation);
    checkpointValue = checkpoints[0];
    checkpointGeneration = checkpointValue?.generation ?? 0;
    committed = records.slice(0, checkpointValue?.sequence ?? 0);
    if (records.length > committed.length || uncertainCheckpoint)
      reason ??= "unconfirmed_tail";
    if (!reason) {
      handle = await fs2.open(
        filename,
        constants4.O_CREAT | constants4.O_APPEND | constants4.O_WRONLY | constants4.O_NOFOLLOW,
        384
      );
      await adapter.syncFile(handle, "open");
      await adapter.syncDirectory(directory, "open");
    }
  } catch (error) {
    reason = error.code === "storage_denied" ? error.code : "storage_denied";
    if (handle) {
      await handle.close();
      handle = void 0;
    }
  }
  const status = () => ({
    state: reason ? "recovery_required" : "ready",
    ...reason && { reason },
    sequence: records.length,
    hash: lastHash,
    checkpointGeneration,
    checkpointSequence: checkpointValue?.sequence ?? 0,
    directoryFlush: "required; platform failures block writes; power-loss durability unverified",
    closed: closedWriter
  });
  const assertWritable = () => {
    if (closedWriter) throw storageError("closed");
    if (reason) throw storageError(reason);
  };
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {
    });
    return task;
  };
  const poison = () => {
    reason = "writer_poisoned";
  };
  async function appendInternal(payload2) {
    assertWritable();
    const validated = validateJournalPayload(payload2);
    if (validated.kind === "recovery_decision")
      need(
        validated.throughSequence === records.length && validated.throughHash === lastHash,
        "identity_conflict"
      );
    const validateHistory = historyValidator();
    for (const record2 of records) validateHistory(record2.payload);
    validateHistory(validated);
    const body = {
      schemaVersion: 1,
      storeId,
      sequence: records.length + 1,
      previousHash: lastHash,
      payload: validated
    };
    const record = { ...body, checksum: hash2(body) };
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    need(bytes.length <= STORAGE_LIMITS.recordBytes);
    try {
      await adapter.write(handle, bytes, "append");
      await adapter.syncFile(handle, `append:${payload2.kind}`);
      await adapter.syncDirectory(directory, "append");
    } catch {
      poison();
      throw storageError(reason);
    }
    records.push(record);
    lastHash = record.checksum;
    return clone(record);
  }
  async function writeFlushed(filename2, value, context, exclusive = false) {
    const file = await fs2.open(
      filename2,
      constants4.O_WRONLY | constants4.O_CREAT | (exclusive ? constants4.O_EXCL : constants4.O_TRUNC) | constants4.O_NOFOLLOW,
      384
    );
    try {
      await adapter.write(
        file,
        Buffer.from(JSON.stringify(value) + "\n"),
        context
      );
      await adapter.syncFile(file, context);
    } finally {
      await file.close();
    }
  }
  async function checkpointInternal() {
    assertWritable();
    const body = {
      schemaVersion: 1,
      storeId,
      generation: checkpointGeneration + 1,
      sequence: records.length,
      hash: lastHash
    };
    const candidate = { ...body, checksum: hash2(body) };
    try {
      await writeFlushed(
        pending,
        { schemaVersion: 1, storeId, baseGeneration: checkpointGeneration },
        "checkpoint:pending",
        !uncertainCheckpoint
      );
      await adapter.syncDirectory(directory, "checkpoint:pending");
      if (checkpointValue)
        await writeFlushed(previous, checkpointValue, "checkpoint:previous");
      await writeFlushed(temp, candidate, "checkpoint:file");
      await adapter.rename(temp, current);
      await adapter.syncDirectory(directory, "checkpoint:publish");
      await adapter.unlink(pending);
    } catch {
      poison();
      throw storageError(reason);
    }
    checkpointValue = candidate;
    checkpointGeneration = candidate.generation;
    committed = records.slice();
    uncertainCheckpoint = false;
    return clone(candidate);
  }
  return {
    status,
    readRecords: () => clone({
      committed,
      uncertain: records.slice(committed.length),
      validated: records
    }),
    append: (payload2) => {
      const copy2 = validateJournalPayload(payload2);
      return serialized(() => appendInternal(copy2));
    },
    checkpoint: () => serialized(checkpointInternal),
    // Only a trusted local host recovery decision may adopt a complete validated tail.
    recover: (decision) => serialized(async () => {
      closed3(decision, [
        "action",
        "expectedSequence",
        "expectedHash",
        "ownerVerified",
        "preflightVerified"
      ]);
      need(
        decision.action === "adopt_validated_tail" && decision.ownerVerified === true && decision.preflightVerified === true && decision.expectedSequence === records.length && decision.expectedHash === lastHash,
        "recovery_denied"
      );
      need(
        reason === "unconfirmed_tail" && !uncertainCheckpoint,
        "recovery_denied"
      );
      reason = void 0;
      try {
        handle = await fs2.open(
          filename,
          constants4.O_APPEND | constants4.O_WRONLY | constants4.O_NOFOLLOW
        );
        await appendInternal({
          kind: "recovery_decision",
          revision: (records.at(-1)?.payload.revision ?? 0) + 1,
          action: decision.action,
          throughSequence: decision.expectedSequence,
          throughHash: decision.expectedHash
        });
        await checkpointInternal();
        return status();
      } catch {
        poison();
        throw storageError(reason);
      }
    }),
    close: () => serialized(async () => {
      if (closedWriter) return;
      closedWriter = true;
      if (handle) {
        await handle.close();
        handle = void 0;
      }
    })
  };
}

// apps/desktop-app/src/host/workspace-registry.mjs
var copy = (value) => JSON.parse(JSON.stringify(value));
var key = (value) => JSON.stringify([value.runtimeEpoch, value.operationId]);
function need2(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
function closed4(value, required, optional = []) {
  need2(
    value && Object.getPrototypeOf(value) === Object.prototype && required.every((field) => Object.hasOwn(value, field)) && Object.keys(value).every(
      (field) => [...required, ...optional].includes(field)
    )
  );
}
function operationKey2(value) {
  closed4(value, ["runtimeEpoch", "operationId"]);
  need2(validWireId(value.runtimeEpoch) && validWireId(value.operationId));
  return key(value);
}
function emptyRoot() {
  return {
    revision: 0,
    operations: /* @__PURE__ */ new Map(),
    workspaces: /* @__PURE__ */ new Map(),
    sessions: /* @__PURE__ */ new Map(),
    tombstones: /* @__PURE__ */ new Map(),
    ownerIntent: void 0,
    migrations: /* @__PURE__ */ new Map()
  };
}
function cloneRoot(root) {
  return {
    revision: root.revision,
    ...Object.fromEntries(
      ["operations", "workspaces", "sessions", "tombstones", "migrations"].map(
        (table) => [
          table,
          new Map([...root[table]].map(([id3, value]) => [id3, copy(value)]))
        ]
      )
    ),
    ownerIntent: root.ownerIntent && copy(root.ownerIntent)
  };
}
var retained = (operation) => !operation.terminal;
function sessionSlots(root, appSessionId) {
  const slots = new Set(root.sessions.keys());
  slots.add(appSessionId);
  for (const operation of root.operations.values())
    if (retained(operation) && operation.reservation)
      slots.add(operation.reservation.appSessionId);
  return slots.size;
}
function initialReceipt(identity, revision, rejectionCode) {
  const { digest: _digest, ...scope } = identity;
  return {
    ...scope,
    revision,
    evidence: [],
    admission: rejectionCode ? "rejected" : "admitted",
    delivery: "pending",
    effect: "none",
    ...rejectionCode && { result: { kind: "rejected", code: rejectionCode } }
  };
}
function sameWorkspace(a, b) {
  return ["workspaceId", "ownership", "canonicalPath", "folderSessionId"].every(
    (field) => a[field] === b[field]
  );
}
function canUseManagedFirstSession(root, workspace) {
  if (workspace.ownership !== "managed" || workspace.registrationState !== "registered" || root.sessions.has(workspace.folderSessionId) || root.tombstones.has(`session:${workspace.folderSessionId}`) || [...root.sessions.values()].some(
    (session) => session.workspaceId === workspace.workspaceId
  ))
    return false;
  const reservations = [...root.operations.values()].filter(
    (entry) => entry.reservation && (entry.reservation.appSessionId === workspace.folderSessionId || entry.reservation.workspace.workspaceId === workspace.workspaceId)
  );
  const creators = reservations.filter(
    (entry) => entry.identity.type === "workspace.create"
  );
  if (creators.length !== 1) return false;
  const creator = creators[0];
  return creator.terminal && creator.receipt.effect === "confirmed" && creator.identity.type === "workspace.create" && !creator.identity.workspaceId && !creator.identity.sessionId && creator.reservation.appSessionId === workspace.folderSessionId && sameWorkspace(creator.reservation.workspace, workspace) && creator.completedDelta?.sessions.length === 0 && creator.completedDelta.workspaces.some(
    (entry) => entry.registrationState === "registered" && sameWorkspace(entry, workspace)
  ) && // Keep every prior identity/reservation. Only a committed zero-dispatch
  // rejection in this exact lineage leaves the first actual session ID free.
  reservations.every(
    (entry) => entry === creator || entry.terminal && entry.identity.type === "session.create" && entry.identity.workspaceId === workspace.workspaceId && !entry.identity.sessionId && entry.reservation.appSessionId === workspace.folderSessionId && sameWorkspace(entry.reservation.workspace, workspace) && entry.receipt.admission === "rejected" && entry.receipt.effect === "none" && entry.dispatches.length === 0 && entry.completedDelta?.workspaces.length === 0 && entry.completedDelta.sessions.length === 0 && entry.completedDelta.tombstones.length === 0
  );
}
function apply(root, payload2, conservative = false, validatedFirstSessions) {
  const next = cloneRoot(root);
  const opKey = key(payload2.identity ?? payload2);
  const operation = next.operations.get(opKey);
  if (payload2.kind === "admission") {
    need2(!operation, "identity_conflict");
    need2(next.operations.size < STORAGE_LIMITS.operations, "retained_limit");
    const receipt = initialReceipt(
      payload2.identity,
      conservative ? root.revision : payload2.revision,
      conservative ? void 0 : payload2.rejectionCode
    );
    if (conservative) {
      receipt.effect = "unknown";
      receipt.delivery = "unknown";
    }
    next.operations.set(opKey, {
      identity: payload2.identity,
      receipt,
      dispatches: [],
      terminal: !conservative && !!payload2.rejectionCode
    });
  } else if (payload2.kind === "reservation") {
    need2(
      operation && !operation.terminal && !operation.reservation,
      "identity_conflict"
    );
    const workspace = next.workspaces.get(payload2.workspace.workspaceId);
    need2(
      !next.tombstones.has(`workspace:${payload2.workspace.workspaceId}`) && !next.tombstones.has(`session:${payload2.appSessionId}`) && !next.sessions.has(payload2.appSessionId),
      "identity_conflict"
    );
    need2(
      !workspace || sameWorkspace(workspace, payload2.workspace),
      "identity_conflict"
    );
    need2(
      ![...next.operations.values()].some(
        (entry) => entry.reservation?.appSessionId === payload2.appSessionId
      ) || operation.identity.type === "session.create" && operation.identity.workspaceId === workspace?.workspaceId && !operation.identity.sessionId && payload2.appSessionId === workspace?.folderSessionId && (canUseManagedFirstSession(next, workspace) || conservative && validatedFirstSessions?.has(opKey)),
      "identity_conflict"
    );
    need2(
      sessionSlots(next, payload2.appSessionId) <= STORAGE_LIMITS.sessions,
      "retained_limit"
    );
    if (!workspace) {
      need2(
        ![...next.workspaces.values()].some(
          (entry) => entry.canonicalPath === payload2.workspace.canonicalPath
        ),
        "identity_conflict"
      );
      need2(next.workspaces.size < STORAGE_LIMITS.workspaces, "retained_limit");
      next.workspaces.set(payload2.workspace.workspaceId, {
        ...payload2.workspace,
        revision: payload2.revision
      });
    }
    operation.reservation = payload2;
    operation.receipt.revision = conservative ? root.revision : payload2.revision;
  } else if (payload2.kind === "dispatch") {
    need2(
      operation && !operation.terminal && !operation.dispatches.some((step) => step.step === payload2.step),
      "identity_conflict"
    );
    operation.dispatches.push(payload2);
    operation.receipt.admission = "dispatched";
    operation.receipt.effect = "unknown";
    operation.receipt.delivery = "unknown";
    operation.receipt.revision = conservative ? root.revision : payload2.revision;
  } else if (payload2.kind === "completion") {
    need2(operation && !operation.terminal, "identity_conflict");
    for (const field of [
      "runtimeEpoch",
      "operationId",
      "type",
      "workspaceId",
      "sessionId"
    ])
      need2(
        payload2.receipt[field] === operation.identity[field],
        "identity_conflict"
      );
    if (conservative) return root;
    const delta = payload2.delta;
    const receipt = payload2.receipt;
    const allowedWorkspaces = new Set(
      [
        operation.identity.workspaceId,
        operation.reservation?.workspace.workspaceId
      ].filter(Boolean)
    );
    for (const workspace of delta.workspaces)
      need2(allowedWorkspaces.has(workspace.workspaceId), "identity_conflict");
    for (const session of delta.sessions) {
      need2(allowedWorkspaces.has(session.workspaceId), "identity_conflict");
      if (session.appSessionId === operation.reservation?.appSessionId)
        need2(
          [
            "workspace.create",
            "workspace.import",
            "session.create",
            "session.fork"
          ].includes(operation.identity.type) && (operation.identity.type !== "session.fork" || operation.identity.sessionId && session.parentSessionId === operation.identity.sessionId),
          "identity_conflict"
        );
      else
        need2(
          next.sessions.has(session.appSessionId) && (operation.identity.type === "workspace.remove" || session.appSessionId === operation.identity.sessionId),
          "identity_conflict"
        );
    }
    for (const tombstone of delta.tombstones) {
      if (tombstone.kind === "workspace")
        need2(
          operation.identity.type === "workspace.remove" && allowedWorkspaces.has(tombstone.id),
          "identity_conflict"
        );
      else
        need2(
          ["session.remove", "workspace.remove"].includes(
            operation.identity.type
          ) && allowedWorkspaces.has(
            next.sessions.get(tombstone.id)?.workspaceId
          ) && (operation.identity.type === "workspace.remove" || tombstone.id === operation.identity.sessionId),
          "identity_conflict"
        );
    }
    const terminal = receipt.effect === "confirmed" || receipt.admission === "rejected";
    need2(
      receipt.effect !== "confirmed" || operation.dispatches.length > 0,
      "identity_conflict"
    );
    need2(
      receipt.effect !== "none" || operation.dispatches.length === 0,
      "identity_conflict"
    );
    need2(
      receipt.admission !== "rejected" || receipt.effect === "none",
      "identity_conflict"
    );
    if (delta.workspaces.length || delta.sessions.length || delta.tombstones.length)
      need2(
        receipt.effect === "confirmed" || receipt.effect === "unknown",
        "identity_conflict"
      );
    const sessionDeletes = new Set(
      delta.tombstones.filter((entry) => entry.kind === "session").map((entry) => entry.id)
    );
    const workspaceDeletes = new Set(
      delta.tombstones.filter((entry) => entry.kind === "workspace").map((entry) => entry.id)
    );
    need2(
      delta.tombstones.length === 0 || receipt.effect === "confirmed",
      "identity_conflict"
    );
    for (const workspace of delta.workspaces) {
      const existing = next.workspaces.get(workspace.workspaceId);
      need2(
        existing && sameWorkspace(existing, workspace) && !workspaceDeletes.has(workspace.workspaceId),
        "identity_conflict"
      );
      need2(
        workspace.registrationState !== "registered" || receipt.effect === "confirmed",
        "identity_conflict"
      );
      next.workspaces.set(workspace.workspaceId, {
        ...workspace,
        revision: payload2.revision
      });
    }
    for (const session of delta.sessions) {
      const workspace = next.workspaces.get(session.workspaceId);
      const existing = next.sessions.get(session.appSessionId);
      need2(
        workspace && !workspaceDeletes.has(session.workspaceId) && !sessionDeletes.has(session.appSessionId) && !next.tombstones.has(`session:${session.appSessionId}`),
        "identity_conflict"
      );
      if (existing)
        need2(
          existing.workspaceId === session.workspaceId && existing.nativeSessionId === session.nativeSessionId && existing.parentSessionId === session.parentSessionId,
          "identity_conflict"
        );
      else
        need2(
          operation.reservation?.appSessionId === session.appSessionId && operation.reservation.workspace.workspaceId === session.workspaceId,
          "identity_conflict"
        );
      if (session.parentSessionId)
        need2(
          next.sessions.get(session.parentSessionId)?.workspaceId === session.workspaceId,
          "identity_conflict"
        );
      if (!existing && session.nativeSessionId) {
        need2(
          receipt.evidence.some(
            (entry) => entry.kind === "native_session_verified" && entry.id === session.nativeSessionId
          ),
          "identity_conflict"
        );
        if (operation.reservation?.plannedNativeSessionId)
          need2(
            operation.reservation.plannedNativeSessionId === session.nativeSessionId,
            "identity_conflict"
          );
        need2(
          ![...next.sessions.values()].some(
            (entry) => entry.nativeSessionId === session.nativeSessionId
          ),
          "identity_conflict"
        );
      }
      if (receipt.effect === "unknown")
        need2(
          session.lifecycleState === "unavailable" && session.recoveryReason === "partial_native_mapping",
          "identity_conflict"
        );
      if (session.lifecycleState === "active")
        need2(
          receipt.effect === "confirmed" && session.nativeSessionId && workspace.registrationState === "registered",
          "identity_conflict"
        );
      next.sessions.set(session.appSessionId, {
        ...session,
        revision: payload2.revision
      });
    }
    for (const tombstone of delta.tombstones) {
      need2(
        !next.tombstones.has(`${tombstone.kind}:${tombstone.id}`),
        "identity_conflict"
      );
      if (tombstone.kind === "session") {
        need2(next.sessions.has(tombstone.id), "identity_conflict");
        need2(
          ![...next.sessions.values()].some(
            (session) => session.parentSessionId === tombstone.id && !sessionDeletes.has(session.appSessionId)
          ),
          "identity_conflict"
        );
        next.sessions.delete(tombstone.id);
      } else {
        need2(next.workspaces.has(tombstone.id), "identity_conflict");
        need2(
          ![...next.sessions.values()].some(
            (session) => session.workspaceId === tombstone.id && !sessionDeletes.has(session.appSessionId)
          ),
          "identity_conflict"
        );
        next.workspaces.delete(tombstone.id);
      }
      next.tombstones.set(`${tombstone.kind}:${tombstone.id}`, {
        ...tombstone,
        runtimeEpoch: payload2.runtimeEpoch,
        operationId: payload2.operationId,
        revision: payload2.revision
      });
    }
    need2(
      next.sessions.size <= STORAGE_LIMITS.sessions && next.tombstones.size <= STORAGE_LIMITS.operations * 300,
      "retained_limit"
    );
    operation.receipt = receipt;
    operation.terminal = terminal;
    operation.completedDelta = delta;
  } else if (payload2.kind === "owner_intent") next.ownerIntent = payload2;
  else if (payload2.kind === "migration_phase")
    next.migrations.set(payload2.migrationId, payload2);
  next.revision = conservative ? root.revision : payload2.revision;
  return next;
}
function recoveryResources(root) {
  const resources = /* @__PURE__ */ new Map();
  const put = (workspaceId, sessionId, reason) => {
    if (!root.workspaces.has(workspaceId) || sessionId && !root.sessions.has(sessionId))
      return;
    const identity = JSON.stringify([workspaceId, sessionId]);
    if (!resources.has(identity))
      resources.set(identity, {
        workspaceId,
        ...sessionId && { sessionId },
        state: "unavailable",
        reason
      });
  };
  for (const session of root.sessions.values())
    if (session.lifecycleState === "unavailable")
      put(
        session.workspaceId,
        session.appSessionId,
        session.recoveryReason ?? "native_mapping_unverified"
      );
  for (const workspace of root.workspaces.values())
    if (workspace.registrationState !== "registered")
      put(
        workspace.workspaceId,
        void 0,
        workspace.registrationState === "reserved" ? "unresolved_operation" : "path_missing"
      );
  for (const operation of root.operations.values())
    if (retained(operation)) {
      const workspaceId = operation.identity.workspaceId ?? operation.reservation?.workspace.workspaceId;
      put(workspaceId, operation.identity.sessionId, "unresolved_operation");
    }
  return [...resources.values()];
}
function pathReason(error) {
  return error.code === "ENOENT" ? "path_missing" : ["EACCES", "EPERM"].includes(error.code) ? "path_denied" : "path_conflict";
}
async function canonicalDirectory2(path2, io, rejectSymlinks = false) {
  need2(
    typeof path2 === "string" && isAbsolute9(path2) && !path2.includes("\0"),
    "path_conflict"
  );
  path2 = resolve3(path2);
  if (rejectSymlinks) {
    const root = parse(path2).root;
    let walked = root;
    for (const component of relative6(root, path2).split(sep3).filter(Boolean)) {
      walked = join8(walked, component);
      const stat2 = await io.lstat(walked);
      need2(stat2.isDirectory() && !stat2.isSymbolicLink(), "path_conflict");
    }
  }
  const canonical = await io.realpath(path2);
  need2((await io.stat(canonical)).isDirectory(), "path_conflict");
  return canonical;
}
async function openWorkspaceRegistry({
  directory,
  storeId,
  documentsPath,
  runtimeEpoch: runtimeEpoch2,
  io = {},
  pathIO = {},
  recoveryReason
} = {}) {
  need2(validWireId(runtimeEpoch2));
  if (recoveryReason !== void 0)
    need2(STORE_RECOVERY_REASONS2.includes(recoveryReason));
  const paths = {
    lstat: fs3.lstat,
    stat: fs3.stat,
    realpath: fs3.realpath,
    mkdir: fs3.mkdir,
    ...pathIO
  };
  const journal = ["owner_conflict", "owner_unverified"].includes(
    recoveryReason
  ) ? void 0 : await openStorageJournal({ directory, storeId, io, recoveryReason });
  let root = emptyRoot();
  let validatedAdmissionKeys = /* @__PURE__ */ new Set();
  let localReason = recoveryReason;
  let queue = Promise.resolve();
  let closedRegistry = false;
  let observationSequence = 0;
  const unavailablePaths = /* @__PURE__ */ new Map();
  if (journal) {
    const { committed, uncertain } = journal.readRecords();
    try {
      for (const record of committed) root = apply(root, record.payload);
    } catch (error) {
      localReason = error.code === "retained_limit" ? error.code : "identity_conflict";
      root = emptyRoot();
    }
    validatedAdmissionKeys = new Set(root.operations.keys());
    if (!localReason && ["ready", "unconfirmed_tail"].includes(
      journal.status().reason ?? journal.status().state
    )) {
      try {
        let validated = root;
        const validatedFirstSessions = /* @__PURE__ */ new Set();
        for (const record of uncertain) {
          const payload2 = record.payload;
          if (payload2.kind === "reservation") {
            const workspace = validated.workspaces.get(
              payload2.workspace.workspaceId
            );
            if (workspace && payload2.appSessionId === workspace.folderSessionId && canUseManagedFirstSession(validated, workspace))
              validatedFirstSessions.add(key(payload2));
          }
          validated = apply(validated, record.payload);
        }
        for (const record of uncertain)
          root = apply(root, record.payload, true, validatedFirstSessions);
      } catch (error) {
        localReason = error.code === "retained_limit" ? error.code : "identity_conflict";
      }
    } else if (!localReason && journal.status().reason !== "retained_limit") {
      try {
        for (const record of uncertain)
          root = apply(root, record.payload, true);
      } catch (error) {
        localReason = error.code === "retained_limit" ? error.code : "identity_conflict";
      }
    }
  }
  for (const workspace of root.workspaces.values()) {
    if (workspace.registrationState === "reserved") continue;
    try {
      need2(
        await canonicalDirectory2(
          workspace.canonicalPath,
          paths,
          workspace.ownership === "managed"
        ) === workspace.canonicalPath,
        "path_conflict"
      );
    } catch (error) {
      unavailablePaths.set(workspace.workspaceId, pathReason(error));
    }
  }
  function storeReason() {
    return localReason ?? journal?.status().reason;
  }
  function status() {
    const reason = storeReason();
    return {
      state: reason ? "recovery_required" : "ready",
      ...reason && { reason },
      revision: root.revision,
      closed: closedRegistry,
      ...journal && { journal: journal.status() }
    };
  }
  function checkWritable() {
    need2(!closedRegistry, "closed");
    const reason = storeReason();
    if (reason) throw storageError(reason);
  }
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {
    });
    return task;
  };
  function getOperation(request) {
    const operation = root.operations.get(operationKey2(request));
    need2(operation && !operation.terminal, "identity_conflict");
    return operation;
  }
  function resources() {
    const result = recoveryResources(root);
    for (const [workspaceId, reason] of unavailablePaths) {
      if (!root.workspaces.has(workspaceId)) continue;
      const existing = result.find(
        (entry) => entry.workspaceId === workspaceId && !entry.sessionId
      );
      if (existing) existing.reason = reason;
      else result.push({ workspaceId, state: "unavailable", reason });
    }
    return result;
  }
  function scopeBlocked(identity, excludeKey) {
    const targets = new Set([identity.workspaceId].filter(Boolean));
    const session = identity.sessionId && root.sessions.get(identity.sessionId);
    if (identity.sessionId)
      need2(session?.workspaceId === identity.workspaceId, "identity_conflict");
    if (identity.workspaceId)
      need2(root.workspaces.has(identity.workspaceId), "identity_conflict");
    for (const resource of resources()) {
      if (!targets.has(resource.workspaceId)) continue;
      if (resource.reason !== "unresolved_operation") return true;
    }
    for (const [otherKey, operation] of root.operations)
      if (otherKey !== excludeKey && retained(operation)) {
        if (targets.has(
          operation.identity.workspaceId ?? operation.reservation?.workspace.workspaceId
        ))
          return true;
      }
    return false;
  }
  async function commit(payload2) {
    const candidate = apply(root, payload2);
    await journal.append(payload2);
    root = candidate;
    if (payload2.kind === "admission")
      validatedAdmissionKeys.add(key(payload2.identity));
  }
  function readView() {
    need2(!closedRegistry, "closed");
    need2(observationSequence < Number.MAX_SAFE_INTEGER, "observation_limit");
    observationSequence++;
    const reason = storeReason();
    const blocked = resources();
    const retainedOperations = [...root.operations.values()].filter(retained).map(({ identity }) => {
      const { digest: _digest, ...retainedKey } = identity;
      return retainedKey;
    });
    need2(
      retainedOperations.length <= STORAGE_LIMITS.operations,
      "retained_limit"
    );
    return copy({
      runtimeEpoch: runtimeEpoch2,
      revision: root.revision,
      observationSequence,
      temporary: false,
      state: reason || blocked.length ? "unavailable" : "ready",
      recovery: {
        store: reason ? { state: "recovery_required", reason } : { state: "ready" },
        resources: blocked
      },
      retainedOperations,
      workspaces: [...root.workspaces.values()].map((workspace) => ({
        ...workspace,
        temporary: false
      })),
      sessions: [...root.sessions.values()].map((session) => ({
        ...session,
        status: reason || blocked.some(
          (entry) => entry.workspaceId === session.workspaceId && (!entry.sessionId || entry.sessionId === session.appSessionId)
        ) ? "unavailable" : session.lifecycleState === "active" ? "idle" : "unavailable"
      })),
      tombstones: [...root.tombstones.values()],
      messages: [],
      permissions: []
    });
  }
  function lookup(request) {
    const operation = root.operations.get(operationKey2(request));
    if (operation)
      return copy({ ...request, status: "found", receipt: operation.receipt });
    const knownEpoch = [...root.operations.values()].some(
      (entry) => entry.identity.runtimeEpoch === request.runtimeEpoch
    ) || request.runtimeEpoch === runtimeEpoch2;
    return {
      ...request,
      status: knownEpoch ? "missing" : "wrong_epoch",
      effect: "unknown"
    };
  }
  function lookupIdentity(request) {
    const opKey = operationKey2(request);
    if (!validatedAdmissionKeys.has(opKey)) return void 0;
    const operation = root.operations.get(opKey);
    return operation && copy(operation.identity);
  }
  function begin(input) {
    closed4(
      input,
      ["runtimeEpoch", "operationId", "type", "digest"],
      ["workspaceId", "sessionId", "expectedRevision", "rejectionCode"]
    );
    const { expectedRevision, rejectionCode, ...identity } = input;
    validateStorageIdentity(identity);
    if (expectedRevision !== void 0)
      need2(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
    if (rejectionCode !== void 0) need2(Object.hasOwn(ERRORS, rejectionCode));
    const immutable = copy(identity);
    return serialized(async () => {
      checkWritable();
      const prior = root.operations.get(key(immutable));
      if (prior) {
        need2(
          isDeepStrictEqual2(prior.identity, immutable),
          "DUPLICATE_CONFLICT"
        );
        return { status: "duplicate", receipt: copy(prior.receipt) };
      }
      need2(root.operations.size < STORAGE_LIMITS.operations, "LIMIT_REACHED");
      const code = rejectionCode ?? (expectedRevision !== void 0 && expectedRevision !== root.revision ? "STALE_REVISION" : scopeBlocked(immutable) ? "UNAVAILABLE" : void 0);
      await commit({
        kind: "admission",
        identity: immutable,
        revision: root.revision + 1,
        ...code && { rejectionCode: code }
      });
      return {
        status: code ? "rejected" : "admitted",
        receipt: copy(root.operations.get(key(immutable)).receipt)
      };
    });
  }
  function reserve(input) {
    closed4(
      input,
      ["runtimeEpoch", "operationId"],
      [
        "ownership",
        "canonicalPath",
        "workspaceId",
        "name",
        "plannedNativeSessionId"
      ]
    );
    const request = copy(input);
    return serialized(async () => {
      checkWritable();
      const operation = getOperation({
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId
      });
      if (operation.reservation) {
        const prior = operation.reservation;
        need2(
          request.plannedNativeSessionId === prior.plannedNativeSessionId,
          "DUPLICATE_CONFLICT"
        );
        need2(
          request.workspaceId ? request.workspaceId === operation.identity.workspaceId && request.workspaceId === prior.workspace.workspaceId : !operation.identity.workspaceId && request.ownership === prior.workspace.ownership,
          "DUPLICATE_CONFLICT"
        );
        if (request.name !== void 0)
          need2(request.name === prior.workspace.name, "DUPLICATE_CONFLICT");
        if (request.canonicalPath !== void 0)
          need2(
            await canonicalDirectory2(request.canonicalPath, paths) === prior.workspace.canonicalPath,
            "DUPLICATE_CONFLICT"
          );
        return {
          status: "duplicate",
          workspace: copy(prior.workspace),
          appSessionId: prior.appSessionId,
          ...prior.plannedNativeSessionId && {
            plannedNativeSessionId: prior.plannedNativeSessionId
          }
        };
      }
      need2(
        !scopeBlocked(operation.identity, key(operation.identity)),
        "UNAVAILABLE"
      );
      let appSessionId = randomUUID5();
      let workspace;
      if (request.workspaceId) {
        const existing = root.workspaces.get(request.workspaceId);
        need2(
          existing && existing.workspaceId === operation.identity.workspaceId,
          "identity_conflict"
        );
        need2(
          request.ownership === void 0 && request.canonicalPath === void 0 && request.name === void 0
        );
        if (operation.identity.type === "session.create" && !operation.identity.sessionId && canUseManagedFirstSession(root, existing))
          appSessionId = existing.folderSessionId;
        workspace = { ...existing, registrationState: "reserved" };
        delete workspace.revision;
      } else {
        need2(
          ["workspace.create", "workspace.import"].includes(
            operation.identity.type
          )
        );
        need2(
          request.ownership === (operation.identity.type === "workspace.create" ? "managed" : "imported")
        );
        let canonicalPath;
        try {
          if (request.ownership === "managed") {
            need2(request.canonicalPath === void 0);
            const documents = await canonicalDirectory2(
              documentsPath,
              paths,
              true
            );
            canonicalPath = join8(documents, "OhMyOwnCode", appSessionId);
          } else
            canonicalPath = await canonicalDirectory2(
              request.canonicalPath,
              paths
            );
        } catch (error) {
          throw storageError(pathReason(error));
        }
        workspace = {
          workspaceId: randomUUID5(),
          ownership: request.ownership,
          canonicalPath,
          registrationState: "reserved",
          ...request.ownership === "managed" && {
            folderSessionId: appSessionId
          },
          ...request.name !== void 0 && { name: request.name }
        };
      }
      const payload2 = {
        kind: "reservation",
        revision: root.revision + 1,
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
        workspace,
        appSessionId,
        ...request.plannedNativeSessionId && {
          plannedNativeSessionId: request.plannedNativeSessionId
        }
      };
      await commit(payload2);
      return {
        status: "reserved",
        workspace: copy(workspace),
        appSessionId,
        ...request.plannedNativeSessionId && {
          plannedNativeSessionId: request.plannedNativeSessionId
        }
      };
    });
  }
  function dispatch(input) {
    closed4(input, ["runtimeEpoch", "operationId", "step"], ["nativeSessionId"]);
    const request = copy(input);
    return serialized(async () => {
      checkWritable();
      const operation = getOperation({
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId
      });
      need2(
        !scopeBlocked(operation.identity, key(operation.identity)),
        "UNAVAILABLE"
      );
      const prior = operation.dispatches.find(
        (entry) => entry.step === request.step
      );
      if (prior) {
        need2(
          prior.nativeSessionId === request.nativeSessionId,
          "DUPLICATE_CONFLICT"
        );
        return { status: "duplicate" };
      }
      if ([
        "workspace.create",
        "workspace.import",
        "session.create",
        "session.fork"
      ].includes(operation.identity.type))
        need2(operation.reservation, "identity_conflict");
      await commit({
        kind: "dispatch",
        ...request,
        revision: root.revision + 1
      });
      return {
        status: "dispatched",
        receipt: copy(root.operations.get(key(request)).receipt)
      };
    });
  }
  function complete(input) {
    closed4(
      input,
      ["runtimeEpoch", "operationId", "receipt", "delta"],
      ["verifiedNativeSessionIds"]
    );
    const request = copy({
      runtimeEpoch: input.runtimeEpoch,
      operationId: input.operationId,
      receipt: redactReceipt(input.receipt),
      delta: validateRegistryDelta(input.delta),
      verifiedNativeSessionIds: input.verifiedNativeSessionIds ?? []
    });
    need2(
      Array.isArray(request.verifiedNativeSessionIds) && request.verifiedNativeSessionIds.length <= 200 && new Set(request.verifiedNativeSessionIds).size === request.verifiedNativeSessionIds.length
    );
    return serialized(async () => {
      checkWritable();
      const operation = root.operations.get(
        operationKey2({
          runtimeEpoch: request.runtimeEpoch,
          operationId: request.operationId
        })
      );
      need2(operation, "identity_conflict");
      const receipt = { ...request.receipt, revision: root.revision + 1 };
      for (const session of request.delta.sessions)
        if (session.nativeSessionId) {
          if (!root.sessions.has(session.appSessionId))
            need2(
              request.verifiedNativeSessionIds.includes(
                session.nativeSessionId
              ),
              "native_mapping_unverified"
            );
          if (request.verifiedNativeSessionIds.includes(
            session.nativeSessionId
          ) && !receipt.evidence.some(
            (entry) => entry.kind === "native_session_verified" && entry.id === session.nativeSessionId
          ))
            receipt.evidence.push({
              kind: "native_session_verified",
              id: session.nativeSessionId
            });
        }
      validateStorageReceipt(receipt);
      if (operation.completedDelta) {
        const { revision: _revision, ...oldReceipt } = operation.receipt;
        const { revision: _newRevision, ...newReceipt } = receipt;
        const identical = isDeepStrictEqual2(oldReceipt, newReceipt) && isDeepStrictEqual2(operation.completedDelta, request.delta);
        if (identical)
          return { status: "duplicate", receipt: copy(operation.receipt) };
        need2(!operation.terminal, "DUPLICATE_CONFLICT");
      } else need2(!operation.terminal, "DUPLICATE_CONFLICT");
      const registeredPaths = new Map(
        request.delta.workspaces.filter((workspace) => workspace.registrationState === "registered").map((workspace) => [workspace.workspaceId, workspace])
      );
      for (const session of request.delta.sessions)
        if (session.lifecycleState === "active")
          registeredPaths.set(
            session.workspaceId,
            root.workspaces.get(session.workspaceId)
          );
      for (const workspace of registeredPaths.values()) {
        need2(workspace, "identity_conflict");
        try {
          need2(
            await canonicalDirectory2(
              workspace.canonicalPath,
              paths,
              workspace.ownership === "managed"
            ) === workspace.canonicalPath,
            "path_conflict"
          );
        } catch (error) {
          const reason = pathReason(error);
          unavailablePaths.set(workspace.workspaceId, reason);
          throw storageError(reason);
        }
      }
      await commit({
        kind: "completion",
        runtimeEpoch: request.runtimeEpoch,
        operationId: request.operationId,
        receipt,
        delta: request.delta,
        revision: root.revision + 1
      });
      return {
        status: "completed",
        receipt: copy(root.operations.get(key(request)).receipt)
      };
    });
  }
  function materializeManaged(request) {
    const opKey = operationKey2(request);
    return serialized(async () => {
      checkWritable();
      const operation = root.operations.get(opKey);
      need2(operation?.reservation && !operation.terminal, "identity_conflict");
      const workspace = operation.reservation.workspace;
      need2(
        workspace.ownership === "managed" && workspace.folderSessionId === operation.reservation.appSessionId,
        "identity_conflict"
      );
      need2(!scopeBlocked(operation.identity, opKey), "UNAVAILABLE");
      const base = resolve3(workspace.canonicalPath, "..");
      const documents = resolve3(base, "..");
      try {
        need2(
          await canonicalDirectory2(documents, paths, true) === documents,
          "path_conflict"
        );
        let baseExists = true;
        try {
          await canonicalDirectory2(base, paths, true);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          baseExists = false;
        }
        for (const [target, step, create] of [
          [base, "filesystem.managed_base", !baseExists],
          [workspace.canonicalPath, "filesystem.managed_folder", true]
        ]) {
          if (!create) continue;
          need2(
            !operation.dispatches.some((entry) => entry.step === step),
            "unresolved_operation"
          );
          try {
            await paths.lstat(target);
            throw storageError("path_conflict");
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          await commit({
            kind: "dispatch",
            ...request,
            step,
            revision: root.revision + 1
          });
          await canonicalDirectory2(resolve3(target, ".."), paths, true);
          await paths.mkdir(target, { mode: 448 });
          await canonicalDirectory2(target, paths, true);
        }
        return { canonicalPath: workspace.canonicalPath };
      } catch (error) {
        if (storeReason()) throw storageError(storeReason());
        const reason = pathReason(error);
        unavailablePaths.set(workspace.workspaceId, reason);
        throw storageError(reason);
      }
    });
  }
  return {
    begin,
    reserve,
    dispatch,
    complete,
    readView,
    lookup,
    lookupIdentity,
    status,
    materializeManaged,
    checkpoint: () => serialized(async () => {
      checkWritable();
      return journal.checkpoint();
    }),
    recordOwnerIntent: (input) => {
      const request = copy(input);
      return serialized(async () => {
        checkWritable();
        await commit({
          ...request,
          kind: "owner_intent",
          revision: root.revision + 1
        });
      });
    },
    recordMigrationPhase: (input) => {
      const request = copy(input);
      return serialized(async () => {
        checkWritable();
        await commit({
          ...request,
          kind: "migration_phase",
          revision: root.revision + 1
        });
      });
    },
    recover: (decision) => serialized(async () => {
      need2(journal && !localReason, "recovery_denied");
      let candidate = emptyRoot();
      for (const record of journal.readRecords().validated)
        candidate = apply(candidate, record.payload);
      await journal.recover(decision);
      candidate.revision = journal.readRecords().committed.at(-1)?.payload.revision ?? 0;
      root = candidate;
      validatedAdmissionKeys = new Set(root.operations.keys());
      return status();
    }),
    close: () => serialized(async () => {
      if (closedRegistry) return;
      closedRegistry = true;
      if (journal) await journal.close();
    })
  };
}

// apps/desktop-app/src/main.mjs
import { randomUUID as randomUUID6 } from "node:crypto";
import { mkdir as mkdir5 } from "node:fs/promises";
var workbench;
var here = dirname2(fileURLToPath(import.meta.url));
var developmentUrl = process.env.OMOC_DESKTOP_DEV_URL;
var runtimeEpoch = randomUUID6();
var namespace;
var owner;
var registry;
var initialRecovery;
var kernel;
try {
  namespace = prepareDurableNamespace(app);
  kernel = createElectronOwnerKernel(app);
  if (!kernel.acquire(namespace.root)) initialRecovery = "owner_conflict";
} catch {
  initialRecovery = "storage_denied";
}
var ephemeralProfile = configureEphemeralProfile(
  app,
  void 0,
  namespace ? [namespace.root, namespace.documents] : []
);
var processIdentity = createOSProcessIdentityAdapter();
var registryPromise = (async () => {
  if (initialRecovery) {
    if (initialRecovery === "owner_conflict") {
      registry = await openWorkspaceRegistry({
        runtimeEpoch,
        recoveryReason: initialRecovery
      });
      return registry;
    }
    throw Object.assign(new Error("storage unavailable"), {
      storageReason: initialRecovery
    });
  }
  owner = createStorageOwner({
    root: namespace.root,
    kernel,
    processVerifier: createProcessVerifier(processIdentity)
  });
  const result = await owner.acquire({ initialize: namespace.fresh });
  if (result.state !== "ready") {
    if (["owner_conflict", "owner_unverified"].includes(result.reason)) {
      registry = await openWorkspaceRegistry({
        runtimeEpoch,
        recoveryReason: result.reason
      });
      return registry;
    }
    throw Object.assign(new Error("owner unavailable"), {
      storageReason: result.reason
    });
  }
  try {
    const manifest = await openDurableManifest(namespace, owner, {
      nativeDatabase: join9(namespace.data, "event-host.sqlite")
    });
    let ownerReason;
    const requireOwner = async () => {
      const current = await owner.assertOwned(owner.getNonce());
      if (current.state !== "ready") {
        ownerReason = current.reason;
        throw Object.assign(new Error("owner unavailable"), {
          storageReason: ownerReason
        });
      }
    };
    const storage = await openWorkspaceRegistry({
      directory: namespace.metadata,
      storeId: manifest.storeId,
      documentsPath: namespace.documents,
      runtimeEpoch,
      pathIO: {
        mkdir: async (...args) => {
          await requireOwner();
          return mkdir5(...args);
        }
      }
    });
    registry = {
      ...storage,
      status: () => ownerReason ? {
        ...storage.status(),
        state: "recovery_required",
        reason: ownerReason
      } : storage.status(),
      readView: () => {
        const view = storage.readView();
        if (ownerReason) {
          view.recovery.store = {
            state: "recovery_required",
            reason: ownerReason
          };
          view.state = "unavailable";
          view.messages = [];
          view.permissions = [];
        }
        return view;
      }
    };
    for (const method of [
      "begin",
      "reserve",
      "dispatch",
      "complete",
      "materializeManaged",
      "recordOwnerIntent",
      "recordMigrationPhase",
      "checkpoint"
    ]) {
      registry[method] = async (...args) => {
        await requireOwner();
        const result2 = await storage[method](...args);
        if (method === "dispatch") await requireOwner();
        return result2;
      };
    }
    return registry;
  } catch (error) {
    throw Object.assign(new Error("manifest unavailable"), {
      storageReason: ["identity_conflict", "unsupported_version"].includes(
        error.message
      ) ? error.message : "storage_denied"
    });
  }
})();
registryPromise.catch(() => {
});
var storageShutdown = false;
async function finishStorage() {
  if (storageShutdown) return;
  await workbench?.drain();
  if (registry) {
    if (registry.status().state === "ready") {
      if (owner?.getNonce())
        await registry.recordOwnerIntent({
          ownerNonce: owner.getNonce(),
          phase: "shutdown"
        });
      await registry.checkpoint();
    }
    await registry.close();
  }
  if (owner?.getNonce()) {
    const result = await owner.release(owner.getNonce());
    if (!result.released) throw new Error("owner release unconfirmed");
  }
  storageShutdown = true;
}
var mainWindow;
var runtime;
var stopPromise;
var startupPromise;
var startupAbortController;
var startupError;
var startupComplete = false;
var quitAfterStartup = false;
var quitPromise;
function allowedRendererUrl(raw) {
  if (developmentUrl && !app.isPackaged) return raw === developmentUrl;
  return raw === pathToFileURL(join9(here, "renderer", "index.html")).href;
}
function admit(event) {
  return Boolean(
    !quitAfterStartup && mainWindow && admitsRendererRequest(event, mainWindow.webContents, allowedRendererUrl)
  );
}
function bindIpc() {
  bindWorkbenchIpc({ ipcMain, admit, service: () => workbench });
  ipcMain.handle("desktop:v1:runtime-snapshot", (event, ...args) => {
    if (!admit(event)) throw new Error("request_denied");
    if (!acceptsNoIpcArguments(args)) throw new Error("request_denied");
    return runtime?.snapshot() ?? { state: "unavailable" };
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join9(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!allowedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const senderScope = String(mainWindow.webContents.id);
  mainWindow.webContents.once(
    "destroyed",
    () => workbench?.closeSender(senderScope)
  );
  mainWindow.webContents.on(
    "render-process-gone",
    () => workbench?.closeSender(senderScope)
  );
  mainWindow.on("closed", () => {
    workbench?.closeSender(senderScope);
    mainWindow = void 0;
  });
  if (developmentUrl && !app.isPackaged) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(join9(here, "renderer", "index.html"));
  }
}
async function stopRuntime() {
  if (!runtime) return { exited: true, cleanup: "complete" };
  if (stopPromise) return stopPromise;
  workbench?.close();
  const active = runtime;
  stopPromise = active.stop().then((result) => {
    if (result.exited && result.cleanup === "complete") {
      runtime = void 0;
    }
    return result;
  }).catch(() => ({ exited: false, cleanup: "incomplete" })).finally(() => {
    stopPromise = void 0;
  });
  return stopPromise;
}
function reportStopFailure() {
  dialog.showErrorBox(
    "Runtime exit unconfirmed",
    "The app could not confirm that its temporary OpenCode process stopped. Keep the app open and try quitting again."
  );
}
function reportCleanupFailure(recoveryPath) {
  dialog.showErrorBox(
    "Temporary data cleanup failed",
    `The app stopped its OpenCode process but could not remove its owned temporary folder. After the app exits, remove this folder manually:
${recoveryPath}`
  );
}
async function finishSidecarStop(stop) {
  let result;
  try {
    result = await stop();
    if (result.exited && result.cleanup === "failed") result = await stop();
  } catch {
    reportStopFailure();
    return;
  }
  if (result.exited && ["complete", "already_stopped"].includes(result.cleanup)) {
    startupError = void 0;
    await finishStorage();
    app.quit();
  } else if (result.exited && result.cleanup === "failed" && result.recoveryPath) {
    reportCleanupFailure(result.recoveryPath);
    runtime = void 0;
    startupError = void 0;
    await finishStorage();
    app.quit();
  } else {
    reportStopFailure();
  }
}
function requestQuit() {
  if (quitPromise) return quitPromise;
  quitPromise = (async () => {
    quitAfterStartup = true;
    if (!startupComplete && startupPromise) {
      startupAbortController?.abort();
      try {
        runtime = await startupPromise;
      } catch (error) {
        startupError = error;
      }
      startupComplete = true;
    }
    if (runtime) {
      await finishSidecarStop(stopRuntime);
      return;
    }
    if (startupError?.cleanupComplete === false && startupError.stopOwnedSidecar) {
      await finishSidecarStop(startupError.stopOwnedSidecar);
      return;
    }
    await finishStorage();
    app.quit();
  })().catch((error) => {
    startupError = error;
    reportStopFailure();
  }).finally(() => {
    quitPromise = void 0;
  });
  return quitPromise;
}
app.whenReady().then(async () => {
  let binaryPath = executableForResources(
    app.isPackaged ? process.resourcesPath : join9(here, "..", "resources"),
    process.platform,
    process.arch
  );
  const e2eScenario = app.isPackaged ? process.env.OMOC_DESKTOP_E2E_SCENARIO : void 0;
  const e2ePort = Number(process.env.OMOC_DESKTOP_E2E_PORT);
  if (e2eScenario === "startup-failure") binaryPath += ".missing-e2e-fixture";
  startupAbortController = new AbortController();
  startupPromise = (async () => {
    const store = await registryPromise;
    const view = store.readView();
    if (view.recovery.store.state !== "ready")
      throw Object.assign(new Error("storage recovery"), {
        storageReason: view.recovery.store.reason
      });
    if (view.retainedOperations.length)
      throw Object.assign(new Error("pending recovery"), {
        storageReason: "native_startup_unverified"
      });
    if (!freshNativePreflight(namespace, store))
      throw Object.assign(new Error("native startup unverified"), {
        storageReason: "native_startup_unverified"
      });
    await store.recordOwnerIntent({
      ownerNonce: owner.getNonce(),
      phase: "startup"
    });
    const eventHost = eventHostForResources(
      app.isPackaged ? process.resourcesPath : join9(here, "..", "resources"),
      process.platform,
      process.arch
    );
    if (e2eScenario === "startup-failure") {
      throw new Error("event_host_missing_e2e_fixture");
    }
    return startSidecar({
      eventHost,
      namespace,
      owner,
      processIdentity,
      preflight: async () => freshNativePreflight(namespace, store),
      binaryPath,
      signal: startupAbortController.signal,
      ...e2eScenario === "startup-timeout" && { startupTimeoutMs: 25 },
      ...e2eScenario === "service-collision" && Number.isInteger(e2ePort) && e2ePort > 0 && e2ePort <= 65535 && { port: e2ePort }
    });
  })();
  startupPromise.catch(() => {
  });
  workbench = createWorkbenchService({
    registry: registryPromise,
    runtimeReady: startupPromise,
    runtimeEpoch,
    bootstrap: true,
    async pickDirectory() {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"]
      });
      return result.canceled ? void 0 : result.filePaths[0];
    },
    async confirmSessionRemoval({ title, workspaceName, path: path2 }) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "\uB300\uD654 \uAE30\uB85D \uC0AD\uC81C",
        message: `\u201C${title}\u201D \uB300\uD654 \uAE30\uB85D\uC744 \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?`,
        detail: `\uC791\uC5C5\uACF5\uAC04: ${workspaceName}
${path2}
\uB300\uD654 \uAE30\uB85D\uB9CC \uC0AD\uC81C\uD558\uBA70 \uD504\uB85C\uC81D\uD2B8 \uD30C\uC77C\uACFC \uD3F4\uB354\uB294 \uC720\uC9C0\uB429\uB2C8\uB2E4.`,
        buttons: ["\uCDE8\uC18C", "\uB300\uD654 \uAE30\uB85D \uC0AD\uC81C"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return result.response === 1;
    },
    async confirmTrust(path2) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Trust this workspace?",
        message: "Opening a session can load project configuration and plugins.",
        detail: path2,
        buttons: ["Cancel", "Trust and open"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return result.response === 1;
    }
  });
  bindIpc();
  createWindow();
  try {
    runtime = await startupPromise;
  } catch (error) {
    startupError = error;
  }
  startupComplete = true;
  if (quitAfterStartup) return;
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("before-quit", (event) => {
  if (storageShutdown) return;
  event.preventDefault();
  void requestQuit();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => {
  try {
    if (storageShutdown) ephemeralProfile.cleanup();
  } catch {
    dialog.showErrorBox(
      "Temporary data cleanup failed",
      `The app could not remove its owned temporary Electron profile. After the app exits, remove this folder manually:
${ephemeralProfile.root}`
    );
  }
});
process.on("uncaughtException", () => {
  void requestQuit().then(() => {
    process.exitCode = 1;
  });
});
process.on("unhandledRejection", () => {
  void requestQuit().then(() => {
    process.exitCode = 1;
  });
});
