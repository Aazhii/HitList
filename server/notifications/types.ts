/**
 * The slice of the Catalyst SDK the notification code uses.
 *
 * Declared structurally rather than importing CatalystApp directly, for two
 * reasons: it keeps this code testable with a small fake instead of a live
 * project, and it documents exactly which SDK surface is depended on — which
 * matters, since the SDK's own types are generated and broad.
 */

export interface CatalystTable {
  insertRow(row: Record<string, string | number | null>): Promise<unknown>;
  updateRow(row: Record<string, string | number | null>): Promise<unknown>;
  deleteRow(rowId: string | number): Promise<unknown>;
}

export interface CatalystDatastore {
  table(name: string): CatalystTable;
}

export interface CatalystZcql {
  executeZCQLQuery(query: string): Promise<Array<Record<string, unknown>>>;
}

export interface CatalystEmail {
  sendMail(mail: {
    from_email: string;
    to_email: string | string[];
    subject: string;
    content?: string;
    html_mode?: boolean;
    display_name?: string;
  }): Promise<unknown>;
}

export interface CatalystWebPush {
  sendNotification(message: string, recipients: string[]): Promise<unknown>;
}

export interface CatalystPushNotification {
  web(): CatalystWebPush;
}

export interface CatalystApp {
  datastore(): CatalystDatastore;
  zcql(): CatalystZcql;
  email(): CatalystEmail;
  pushNotification(): CatalystPushNotification;
}
