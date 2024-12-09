//modules
import { Client, PoolClient } from 'pg';
//stackpress
import type { 
  Dialect, 
  Connection, 
  QueryObject
} from '@stackpress/inquire/dist/types';
import Pgsql from '@stackpress/inquire/dist/dialect/Pgsql';
import Exception from '@stackpress/inquire/dist/Exception';
//local
import type { Results } from './types';

export default class PGConnection implements Connection {
  //sql language dialect
  public readonly dialect: Dialect = Pgsql;

  //the database connection
  public readonly resource: Client|PoolClient;

  /**
   * Set the connection
   */
  public constructor(resource: Client|PoolClient) {
    this.resource = resource;
  }

  /**
   * Query the database. Should return just the expected 
   * results, because the raw results depends on the 
   * native database connection. Any code that uses this 
   * library should not care about the kind of database.
   */
  public async query<R = unknown>(queries: QueryObject[]) {
    const results = await this.raw<R>(queries);
    return results.rows;
  }

  /**
   * Returns queries and returns the raw results 
   * dictated by the native database connection.
   */
  public async raw<R = unknown>(queries: QueryObject[]) {
    if (queries.length === 0) {
      throw Exception.for('No queries to execute.');
    } 

    const queue = queries.slice();
    const last = queue.pop() as QueryObject;
    
    if (queue.length === 0) {
      const formatted = this._format(last);
      return await this._query<R>(formatted);
    }
    try {
      await this._query({ query: 'BEGIN', values: [] });
      for (const request of queries) {
        const formatted = this._format(request);
        await this._query<R>(formatted);
      }
      const formatted = this._format(last);
      const results = await this._query<R>(formatted);
      await this._query({ query: 'COMMIT', values: [] });
      if (this.resource instanceof Client === false) {
        //single clients don't need release
        this.resource.release();
      }
      return results;
    } catch (e) {
      await this._query({ query: 'ROLLBACK', values: [] });
      if (this.resource instanceof Client === false) {
        //single clients don't need release
        this.resource.release();
      }
      throw e;
    }
  }

  /**
   * Formats the query to what the database connection understands
   * Formats the values to what the database connection accepts 
   */
  protected _format(request: QueryObject) {
    let { query, values = [] } = request;
    for (let i = 0; i < values.length; i++) {
      if (!query.includes('?')) {
        throw Exception.for(
          'Query does not match the number of values.'
        );
      }
      //format the query
      query = query.replace('?', `$${i + 1}`);
      //check the value for Date and arrays and objects
      const value = values[i];
      if (value instanceof Date) {
        values[i] = value.toISOString();
      } else if (Array.isArray(value)) {
        values[i] = JSON.stringify(value);
      } else if (value && typeof value === 'object') {
        values[i] = JSON.stringify(value);
      }
    }
    if (query.includes('?')) {
      throw Exception.for(
        'Query does not match the number of values.'
      );
    }
    return { query, values };
  }

  /**
   * Call the database. If no values are provided, use exec
   */
  protected _query<R = unknown>(request: QueryObject) {
    const { query, values = [] } = request;
    return this.resource.query(query, values) as unknown as Promise<Results<R>>;
  }
}