import { getMongoModel, Schema } from '../../../common/mongo';
import {
  TeamCollectionName,
  TeamMemberCollectionName
} from '@fastgpt/global/support/user/team/constant';

export const InitDataCollectionName = 'init_datas';

export type InitDataSchemaType = {
  _id: string;
  key: string;
  name: string;
  teamId: string;
  tmbId: string;
  knowledgeBaseFolderId: string;
  appId: string;
  project: string;
  createTime: Date;
  updateTime: Date;
};

const InitDataSchema = new Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  teamId: {
    type: Schema.Types.ObjectId,
    ref: TeamCollectionName,
    required: true
  },
  tmbId: {
    type: Schema.Types.ObjectId,
    ref: TeamMemberCollectionName,
    required: true
  },
  knowledgeBaseFolderId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  project: {
    type: String,
    required: true
  },
  appId: {
    type: Schema.Types.ObjectId,
    required: false
  },
  createTime: {
    type: Date,
    default: () => new Date()
  },
  updateTime: {
    type: Date,
    default: () => new Date()
  }
});

try {
  InitDataSchema.index({ key: 1 }, { unique: true });
  InitDataSchema.index({ teamId: 1 });
  InitDataSchema.index({ createTime: -1 });
  InitDataSchema.index({ teamId: 1, name: 1, project: 1 }, { unique: true });
} catch (error) {
  console.log(error);
}

export const MongoInitData = getMongoModel<InitDataSchemaType>(
  InitDataCollectionName,
  InitDataSchema
);
