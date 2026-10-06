/// <reference lib="webworker" />

/**
 * Merge worker.
 *
 * Parsing and serialising a 3.4 MB save costs tens of milliseconds of
 * straight-line CPU. Off the main thread that becomes a background task
 * instead of a dropped frame, and the progress readout stays honest.
 */

import { parseCsvRecords } from '../core/csv';
import { indexCsv, merge } from '../core/merge';
import type { SaveData } from '../core/types';
import { toSummary } from './protocol';
import type { MergeRequest, MergeResponse } from './protocol';

self.onmessage = (event: MessageEvent<MergeRequest>) => {
  const req = event.data;
  if (!req || req.kind !== 'merge') return;

  let response: MergeResponse;
  try {
    let save: SaveData;
    try {
      save = JSON.parse(req.saveText) as SaveData;
    } catch (err) {
      post({ ok: false, stage: 'parse-save', message: describe(err) });
      return;
    }
    if (!Array.isArray(save?.userMusicDetailList)) {
      post({
        ok: false,
        stage: 'parse-save',
        message:
          'This file has no "userMusicDetailList" array. Please choose a save exported from RinNet.',
      });
      return;
    }

    let index;
    try {
      const { records, malformed } = parseCsvRecords(req.csvText);
      if (malformed.length > 0) {
        post({
          ok: false,
          stage: 'parse-csv',
          message:
            `The score CSV looks damaged: ${malformed.length} row(s) have the wrong ` +
            `number of columns (first at line ${malformed[0]}).`,
        });
        return;
      }
      index = indexCsv(records);
    } catch (err) {
      post({ ok: false, stage: 'parse-csv', message: describe(err) });
      return;
    }

    const result = merge(save, index, { injectPlaylogs: req.injectPlaylogs });
    // Compact on purpose: the merged file is imported straight into a web
    // form, and nobody reads it.
    const outputText = JSON.stringify(result.data);

    response = {
      ok: true,
      outputText,
      summary: toSummary(result, req.saveText.length, outputText),
    };
  } catch (err) {
    response = { ok: false, stage: 'merge', message: describe(err) };
  }

  post(response);
};

function post(message: MergeResponse): void {
  (self as unknown as Worker).postMessage(message);
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}