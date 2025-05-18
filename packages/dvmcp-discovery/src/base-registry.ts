import type { Capability, ProviderServerMeta } from './base-interfaces';

export abstract class BaseRegistry<T extends Capability> {
  protected items: Map<string, { item: T } & ProviderServerMeta> = new Map();
  protected serverItems: Map<string, T[]> = new Map();

  constructor(protected mcpServer: any) {}

  public getItem(id: string): T | undefined {
    return this.items.get(id)?.item;
  }

  public getItemInfo(
    id: string
  ): ({ item: T } & ProviderServerMeta) | undefined {
    return this.items.get(id);
  }

  public listItems(): T[] {
    return Array.from(this.items.values()).map(({ item }) => item);
  }

  public listItemsWithIds(): [string, T][] {
    return Array.from(this.items.entries()).map(([id, { item }]) => [id, item]);
  }

  public removeItem(id: string): boolean {
    return this.items.delete(id);
  }

  public removeItemsByProvider(providerPubkey: string): string[] {
    const removed: string[] = [];
    for (const [id, meta] of this.items.entries()) {
      if (meta.providerPubkey === providerPubkey) {
        this.items.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  public removeItemsByPattern(pattern: RegExp): string[] {
    const removed: string[] = [];
    for (const [id, meta] of this.items.entries()) {
      if (pattern.test(id)) {
        this.items.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  public clear(): void {
    this.items.clear();
    this.serverItems.clear();
  }

  protected abstract registerWithMcp(id: string, item: T): void;
}
