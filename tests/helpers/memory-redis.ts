/** Offline Redis test double. The optional socket integration suite exercises the real Lua scripts. */
export class MemoryRedis {
  values = new Map<string, string | Set<string> | string[]>();
  expiries = new Map<string, number>();

  reset() { this.values.clear(); this.expiries.clear(); }
  private read(key: string) {
    if ((this.expiries.get(key) ?? Infinity) <= Date.now()) { this.values.delete(key); this.expiries.delete(key); }
    return this.values.get(key);
  }
  async get(key: string) { return this.read(key) as string | undefined ?? null; }
  async set(key: string, value: string, ...args: (string | number)[]) {
    if (args.includes("NX") && this.read(key) !== undefined) return null;
    this.values.set(key, value);
    this.expiries.delete(key);
    const ex = args.indexOf("EX");
    if (ex >= 0) this.expiries.set(key, Date.now() + Number(args[ex + 1]) * 1000);
    return "OK";
  }
  async smembers(key: string) { return [...(this.read(key) as Set<string> | undefined ?? [])]; }
  async mget(...keys: string[]) { return Promise.all(keys.map((key) => this.get(key))); }
  async lrange(key: string, start: number, stop: number) {
    const values = this.read(key) as string[] | undefined ?? [];
    return values.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async ttl(key: string) {
    if (this.read(key) === undefined) return -2;
    return this.expiries.has(key) ? Math.ceil((this.expiries.get(key)! - Date.now()) / 1000) : -1;
  }
  async eval(script: string, _keyCount: number, key: string, token: string, commandsJson?: string) {
    if (await this.get(key) !== token) return 0;
    if (!commandsJson) { this.values.delete(key); this.expiries.delete(key); return 1; }
    for (const command of JSON.parse(commandsJson) as (string | number)[][]) {
      const [name, commandKey, ...args] = command;
      const target = String(commandKey);
      if (name === "SET") await this.set(target, String(args[0]), ...args.slice(1));
      else if (name === "SADD") {
        const values = this.read(target) as Set<string> | undefined ?? new Set<string>();
        args.forEach((value) => values.add(String(value))); this.values.set(target, values);
      } else if (name === "EXPIRE") {
        if (this.read(target) !== undefined) this.expiries.set(target, Date.now() + Number(args[0]) * 1000);
      } else if (name === "RPUSH") {
        const values = this.read(target) as string[] | undefined ?? []; values.push(String(args[0])); this.values.set(target, values);
      } else if (name === "LTRIM") {
        const values = this.read(target) as string[] | undefined ?? []; this.values.set(target, values.slice(Number(args[0]), Number(args[1]) === -1 ? undefined : Number(args[1]) + 1));
      } else if (name === "DEL") {
        [target, ...args.map(String)].forEach((value) => { this.values.delete(value); this.expiries.delete(value); });
      } else throw new Error(`Unsupported test command: ${name}`);
    }
    return 1;
  }
}
