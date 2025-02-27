import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';

import { DB } from 'src/db';
import { DummyValue, GenerateSql } from 'src/decorators';
import { OcrEntity } from 'src/entities/ocr.entity';

@Injectable()
export class OcrRepository {
  constructor(@InjectKysely() private database: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  findOcrByAssetId(assetId: string): Promise<OcrEntity | null> {
    return this.database
      .selectFrom('asset_ocr')
      .selectAll('asset_ocr')
      .where('asset_ocr.assetId', '=', assetId)
      .executeTakeFirst() as Promise<OcrEntity | null>;
  }

  async createOcrRecord(assetId: string, extractedText: string): Promise<void> {
    await this.database
      .insertInto('asset_ocr')
      .values({ assetId, text: extractedText })
      .execute();
  }

  async clearAllOcrData(): Promise<void> {
    await sql`truncate ${sql.table('asset_ocr')}`.execute(this.database);
  }

  streamAllOcrRecords(filterOptions: Partial<OcrEntity> = {}): AsyncIterableIterator<OcrEntity> {
    return this.database
      .selectFrom('asset_ocr')
      .selectAll('asset_ocr')
      .$if(!!filterOptions.assetId, (queryBuilder) => 
        queryBuilder.where('asset_ocr.assetId', '=', filterOptions.assetId!)
      )
      .stream() as AsyncIterableIterator<OcrEntity>;
  }


  @GenerateSql()
  async getMostRecentOcrTimestamp(): Promise<string | undefined> {
    const queryResult = (await this.database
      .selectFrom('asset_job_status')
      .select((expressionBuilder) => 
        sql`${expressionBuilder.fn.max('asset_job_status.ocrAt')}::text`.as('latestDate')
      )
      .executeTakeFirst()) as { latestDate: string } | undefined;

    return queryResult?.latestDate;
  }

  async modifyOcrText(recordId: string, newTextContent: string): Promise<void> {
    await this.database
      .updateTable('asset_ocr')
      .set({ text: newTextContent })
      .where('id', '=', recordId)
      .execute();
  }

  findEmptyOcrRecords(): Promise<OcrEntity[]> {
    return this.database
      .selectFrom('asset_ocr')
      .selectAll('asset_ocr')
      .where('text', 'is', null)
      .execute() as Promise<OcrEntity[]>;
  }

  async removeOcrRecords(recordsToDelete: OcrEntity[]): Promise<void> {
    await this.database
      .deleteFrom('asset_ocr')
      .where('id', 'in', recordsToDelete.map((record) => record.id))
      .execute();
  }
}
