import moment from 'moment';
import { Sequelize, Op, DataTypes, fn, col, literal } from 'sequelize';
import { databaseConfig } from './config.js';
import {logger} from "./logger.js";
import * as Promises from './promises.js';

const database = new Sequelize(
    databaseConfig.POSTGRES_URI,
    {
        logging: false
    }
);

const Provider = database.define('provider', {
    name: { type: DataTypes.STRING(32), primaryKey: true },
    lastScraped: { type: DataTypes.DATE },
    lastScrapedId: { type: DataTypes.STRING(128) }
});

const IngestedTorrent = database.define('ingested_torrent', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    name: DataTypes.STRING,
    source: DataTypes.STRING,
    category: DataTypes.STRING,
    info_hash: DataTypes.STRING,
    size: DataTypes.STRING,
    seeders: DataTypes.INTEGER,
    leechers: DataTypes.INTEGER,
    imdb: DataTypes.STRING,
    processed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
},
    {
        indexes: [
            {
                unique: true,
                fields: ['source', 'info_hash']
            }
        ]
    })

/* eslint-disable no-unused-vars */
const IngestedPage = database.define('ingested_page', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    url: { type: DataTypes.STRING, allowNull: false },
},
    {
        indexes: [
            {
                unique: true,
                fields: ['url']
            }
        ]
    })
/* eslint-enable no-unused-vars */

const Torrent = database.define('torrent',
    {
        infoHash: { type: DataTypes.STRING(64), primaryKey: true },
        provider: { type: DataTypes.STRING(32), allowNull: false },
        torrentId: { type: DataTypes.STRING(512) },
        title: { type: DataTypes.STRING(512), allowNull: false },
        size: { type: DataTypes.BIGINT },
        type: { type: DataTypes.STRING(16), allowNull: false },
        uploadDate: { type: DataTypes.DATE, allowNull: false },
        seeders: { type: DataTypes.SMALLINT },
        trackers: { type: DataTypes.STRING(8000) },
        languages: { type: DataTypes.STRING(4096) },
        resolution: { type: DataTypes.STRING(16) },
        reviewed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        opened: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    }
);

const File = database.define('file',
    {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        infoHash: {
            type: DataTypes.STRING(64),
            allowNull: false,
            references: { model: Torrent, key: 'infoHash' },
            onDelete: 'CASCADE'
        },
        fileIndex: { type: DataTypes.INTEGER },
        title: { type: DataTypes.STRING(512), allowNull: false },
        size: { type: DataTypes.BIGINT },
        imdbId: { type: DataTypes.STRING(32) },
        imdbSeason: { type: DataTypes.INTEGER },
        imdbEpisode: { type: DataTypes.INTEGER },
        kitsuId: { type: DataTypes.INTEGER },
        kitsuEpisode: { type: DataTypes.INTEGER }
    },
    {
        indexes: [
            {
                unique: true,
                name: 'files_unique_file_constraint',
                fields: [
                    col('infoHash'),
                    fn('COALESCE', (col('fileIndex')), -1),
                    fn('COALESCE', (col('imdbId')), 'null'),
                    fn('COALESCE', (col('imdbSeason')), -1),
                    fn('COALESCE', (col('imdbEpisode')), -1),
                    fn('COALESCE', (col('kitsuId')), -1),
                    fn('COALESCE', (col('kitsuEpisode')), -1)
                ]
            },
            { unique: false, fields: ['imdbId', 'imdbSeason', 'imdbEpisode'] },
            { unique: false, fields: ['kitsuId', 'kitsuEpisode'] }
        ]
    }
);

const Subtitle = database.define('subtitle',
    {
        infoHash: {
            type: DataTypes.STRING(64),
            allowNull: false,
            references: { model: Torrent, key: 'infoHash' },
            onDelete: 'CASCADE'
        },
        fileIndex: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        fileId: {
            type: DataTypes.BIGINT,
            allowNull: true,
            references: { model: File, key: 'id' },
            onDelete: 'SET NULL'
        },
        title: { type: DataTypes.STRING(512), allowNull: false },
    },
    {
        timestamps: false,
        indexes: [
            {
                unique: true,
                name: 'subtitles_unique_subtitle_constraint',
                fields: [
                    col('infoHash'),
                    col('fileIndex'),
                    fn('COALESCE', (col('fileId')), -1)
                ]
            },
            { unique: false, fields: ['fileId'] }
        ]
    }
);

const Content = database.define('content',
    {
        infoHash: {
            type: DataTypes.STRING(64),
            primaryKey: true,
            allowNull: false,
            references: { model: Torrent, key: 'infoHash' },
            onDelete: 'CASCADE'
        },
        fileIndex: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false
        },
        path: { type: DataTypes.STRING(512), allowNull: false },
        size: { type: DataTypes.BIGINT },
    },
    {
        timestamps: false,
    }
);

const SkipTorrent = database.define('skip_torrent', {
    infoHash: { type: DataTypes.STRING(64), primaryKey: true },
});

Torrent.hasMany(File, { foreignKey: 'infoHash', constraints: false });
File.belongsTo(Torrent, { foreignKey: 'infoHash', constraints: false });
Torrent.hasMany(Content, { foreignKey: 'infoHash', constraints: false });
Content.belongsTo(Torrent, { foreignKey: 'infoHash', constraints: false });
File.hasMany(Subtitle, { foreignKey: 'fileId', constraints: false });
Subtitle.belongsTo(File, { foreignKey: 'fileId', constraints: false });

export function connect() {
    if (databaseConfig.ENABLE_SYNC) {
        return database.sync({ alter: true })
            .catch(error => {
                console.error('Failed syncing database: ', error);
                throw error;
            });
    }
    return Promise.resolve();
}

export function getProvider(provider) {
    return Provider.findOrCreate({ where: { name: { [Op.eq]: provider.name } }, defaults: provider })
        .then((result) => result[0])
        .catch(() => provider);
}

export function getTorrent(torrent) {
    const where = torrent.infoHash
        ? { infoHash: torrent.infoHash }
        : { provider: torrent.provider, torrentId: torrent.torrentId }
    return Torrent.findOne({ where: where });
}

export function getTorrentsBasedOnTitle(titleQuery, type) {
    return getTorrentsBasedOnQuery({ title: { [Op.regexp]: `${titleQuery}` }, type: type });
}

export function getTorrentsBasedOnQuery(where) {
    return Torrent.findAll({ where: where });
}

export function getFilesBasedOnQuery(where) {
    return File.findAll({ where: where });
}

export function getUnprocessedIngestedTorrents() {
    return IngestedTorrent.findAll({
        where: {
            processed: false,
            category: {
                [Op.or]: ['tv', 'movies']
            }
        },

    });
}

export function setIngestedTorrentsProcessed(ingestedTorrents) {
    return Promises.sequence(ingestedTorrents
        .map(ingestedTorrent => () => {
            ingestedTorrent.processed = true;
            return ingestedTorrent.save();
        }));
}

export function getTorrentsWithoutSize() {
    return Torrent.findAll({
        where: literal(
            'exists (select 1 from files where files."infoHash" = torrent."infoHash" and files.size = 300000000)'),
        order: [
            ['seeders', 'DESC']
        ]
    });
}

export function getUpdateSeedersTorrents(limit = 50) {
    const until = moment().subtract(7, 'days').format('YYYY-MM-DD');
    return Torrent.findAll({
        where: literal(`torrent."updatedAt" < '${until}'`),
        limit: limit,
        order: [
            ['seeders', 'DESC'],
            ['updatedAt', 'ASC']
        ]
    });
}

export function getUpdateSeedersNewTorrents(limit = 50) {
    const lastUpdate = moment().subtract(12, 'hours').format('YYYY-MM-DD');
    const createdAfter = moment().subtract(4, 'days').format('YYYY-MM-DD');
    return Torrent.findAll({
        where: literal(`torrent."updatedAt" < '${lastUpdate}' AND torrent."createdAt" > '${createdAfter}'`),
        limit: limit,
        order: [
            ['seeders', 'ASC'],
            ['updatedAt', 'ASC']
        ]
    });
}

export function getNoContentsTorrents() {
    return Torrent.findAll({
        where: { opened: false, seeders: { [Op.gte]: 1 } },
        limit: 500,
        order: [[fn('RANDOM')]]
    });
}

export function createTorrent(torrent) {
    return Torrent.upsert(torrent)
        .then(() => createContents(torrent.infoHash, torrent.contents))
        .then(() => createSubtitles(torrent.infoHash, torrent.subtitles));
}

export function setTorrentSeeders(torrent, seeders) {
    const where = torrent.infoHash
        ? { infoHash: torrent.infoHash }
        : { provider: torrent.provider, torrentId: torrent.torrentId }
    return Torrent.update(
        { seeders: seeders },
        { where: where }
    );
}

export function deleteTorrent(torrent) {
    return Torrent.destroy({ where: { infoHash: torrent.infoHash } })
}

export function createFile(file) {
    if (file.id) {
        return (file.dataValues ? file.save() : File.upsert(file))
            .then(() => upsertSubtitles(file, file.subtitles));
    }
    if (file.subtitles && file.subtitles.length) {
        file.subtitles = file.subtitles.map(subtitle => ({ infoHash: file.infoHash, title: subtitle.path, ...subtitle }));
    }
    return File.create(file, { include: [Subtitle], ignoreDuplicates: true });
}

export function getFiles(torrent) {
    return File.findAll({ where: { infoHash: torrent.infoHash } });
}

export function getFilesBasedOnTitle(titleQuery) {
    return File.findAll({ where: { title: { [Op.regexp]: `${titleQuery}` } } });
}

export function deleteFile(file) {
    return File.destroy({ where: { id: file.id } })
}

export function createSubtitles(infoHash, subtitles) {
    if (subtitles && subtitles.length) {
        return Subtitle.bulkCreate(subtitles.map(subtitle => ({ infoHash, title: subtitle.path, ...subtitle })));
    }
    return Promise.resolve();
}

export function upsertSubtitles(file, subtitles) {
    if (file.id && subtitles && subtitles.length) {
        return Promises.sequence(subtitles
            .map(subtitle => {
                subtitle.fileId = file.id;
                subtitle.infoHash = subtitle.infoHash || file.infoHash;
                subtitle.title = subtitle.title || subtitle.path;
                return subtitle;
            })
            .map(subtitle => () => subtitle.dataValues ? subtitle.save() : Subtitle.create(subtitle)));
    }
    return Promise.resolve();
}

export function getSubtitles(torrent) {
    return Subtitle.findAll({ where: { infoHash: torrent.infoHash } });
}

export function getUnassignedSubtitles() {
    return Subtitle.findAll({ where: { fileId: null } });
}

export function createContents(infoHash, contents) {
    if (contents && contents.length) {
        return Content.bulkCreate(contents.map(content => ({ infoHash, ...content })), { ignoreDuplicates: true })
            .then(() => Torrent.update({ opened: true }, { where: { infoHash: infoHash }, silent: true }));
    }
    return Promise.resolve();
}

export function getContents(torrent) {
    return Content.findAll({ where: { infoHash: torrent.infoHash } });
}

export function getSkipTorrent(torrent) {
    return SkipTorrent.findByPk(torrent.infoHash)
        .then((result) => {
            if (!result) {
                throw new Error(`torrent not found: ${torrent.infoHash}`);
            }
            return result.dataValues;
        })
}

export function createSkipTorrent(torrent) {
    return SkipTorrent.upsert({ infoHash: torrent.infoHash });
}
