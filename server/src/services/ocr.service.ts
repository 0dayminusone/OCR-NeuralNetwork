import { Injectable } from '@nestjs/common';

import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { getAssetFiles } from 'src/utils/asset.util';
import { isOcrEnabled } from 'src/utils/misc';

@Injectable()
export class OcrService extends BaseService {
  @OnJob({ name: JobName.OCR_CLEANUP, queue: QueueName.BACKGROUND_TASK })
  async performOcrCleanup(): Promise<JobStatus> {
    const emptyOcrRecords = await this.ocrRepository.findEmptyOcrRecords();
    await this.ocrRepository.removeOcrRecords(emptyOcrRecords);
    return JobStatus.SUCCESS;
  }

  @OnJob({ name: JobName.QUEUE_OCR, queue: QueueName.OCR })
  async processOcrQueue({ force, nightly }: JobOf<JobName.QUEUE_OCR>): Promise<JobStatus> {
    const { machineLearning: mlConfig } = await this.getConfig({ withCache: false });
    
    if (!isOcrEnabled(mlConfig)) {
      return JobStatus.SKIPPED;
    }

    // Clear existing OCR data if force flag is set
    if (force) {
      await this.ocrRepository.clearAllOcrData();
    }

    let pendingJobs: JobItem[] = [];
    const assetStream = this.assetJobRepository.streamForOcrJob(force);

    for await (const assetItem of assetStream) {
      pendingJobs.push({ name: JobName.OCR, data: { id: assetItem.id } });

      // Process jobs in batches to avoid overwhelming the queue
      if (pendingJobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(pendingJobs);
        pendingJobs = [];
      }
    }

    // Queue any remaining jobs
    await this.jobRepository.queueAll(pendingJobs);

    // Schedule cleanup unless this is a forced run
    if (force === undefined) {
      await this.jobRepository.queue({ name: JobName.OCR_CLEANUP });
    }

    return JobStatus.SUCCESS;
  }

  @OnJob({ name: JobName.OCR, queue: QueueName.OCR })
  async executeOcrProcessing({ id }: JobOf<JobName.OCR>): Promise<JobStatus> {
    const { machineLearning: mlConfiguration } = await this.getConfig({ withCache: true });
    
    if (!isOcrEnabled(mlConfiguration)) {
      return JobStatus.SKIPPED;
    }

    // Fetch asset with file relations
    const assetWithFiles = await this.assetRepository.getById(id, { files: true });
    if (!assetWithFiles || !assetWithFiles.files) {
      return JobStatus.FAILED;
    }

    const { previewFile: imageFile } = getAssetFiles(assetWithFiles.files);
    if (!imageFile) {
      return JobStatus.FAILED;
    }

    // Perform OCR analysis
    const textExtractionResult = await this.machineLearningRepository.ocr(
      mlConfiguration.urls,
      imageFile.path,
      mlConfiguration.ocr,
    );

    // Handle empty OCR results
    if (!textExtractionResult?.text?.length) {
      this.logger.warn(`OCR processing yielded no text for asset ${id}`);
      await this.updateJobTimestamp(assetWithFiles.id);
      return JobStatus.SUCCESS;
    }

    this.logger.debug(`Successfully extracted text from asset ${id}`);

    // Update or create OCR record
    const existingOcrRecord = await this.ocrRepository.findOcrByAssetId(id);
    if (existingOcrRecord) {
      this.logger.debug(`Updating existing OCR record for asset ${id}`);
      await this.ocrRepository.modifyOcrText(id, textExtractionResult.text);
    } else {
      this.logger.debug(`Creating new OCR record for asset ${id}`);
      await this.ocrRepository.createOcrRecord(id, textExtractionResult.text);
    }

    await this.updateJobTimestamp(assetWithFiles.id);
    this.logger.debug(`OCR processing completed for asset ${id}`);
    return JobStatus.SUCCESS;
  }

  private async updateJobTimestamp(assetId: string): Promise<void> {
    await this.assetRepository.upsertJobStatus({
      assetId,
      ocrAt: new Date(),
    });
  }
}