export class SupabaseStore {
  constructor({ api, tables, onError }) {
    this.api = api;
    this.tables = tables;
    this.onError = onError;
  }

  assertReady() {
    if (!this.api) throw new Error("Supabase no est\u00e1 configurado.");
  }

  async select(name, options = {}) {
    this.assertReady();
    try {
      return await this.api.select(name, options);
    } catch (error) {
      return this.fail(`No se pudo leer ${this.tables[name]}`, error);
    }
  }

  async insert(name, row) {
    this.assertReady();
    try {
      await this.api.insert(name, row);
    } catch (error) {
      this.fail(`No se pudo insertar en ${this.tables[name]}`, error);
    }
  }

  async update(name, id, changes) {
    this.assertReady();
    try {
      await this.api.update(name, id, changes);
    } catch (error) {
      this.fail(`No se pudo actualizar ${this.tables[name]}`, error);
    }
  }

  async delete(name, id) {
    this.assertReady();
    try {
      await this.api.delete(name, id);
    } catch (error) {
      this.fail(`No se pudo eliminar en ${this.tables[name]}`, error);
    }
  }

  async batchUpsert(name, rows) {
    this.assertReady();
    try {
      await this.api.batchUpsert(name, rows);
    } catch (error) {
      this.fail(`No se pudo actualizar ${this.tables[name]}`, error);
    }
  }

  async batchUpdate(name, ids, changes) {
    this.assertReady();
    try {
      await this.api.batchUpdate(name, ids, changes);
    } catch (error) {
      this.fail(`No se pudo actualizar ${this.tables[name]}`, error);
    }
  }

  fail(message, error) {
    const detail = error?.message ? `${message}: ${error.message}` : message;
    if (this.onError) this.onError(detail);
    throw new Error(detail);
  }
}
