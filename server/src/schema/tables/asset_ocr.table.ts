import { Column, PrimaryGeneratedColumn, Table } from 'src/sql-tools';

@Table('asset_ocr')
export class AssetOcrTable {
  @PrimaryGeneratedColumn()
  id!: string;

  @Column({ type: 'uuid' })
  assetId!: string;

  @Column({ type: 'text', nullable: true })
  text!: string;
}
