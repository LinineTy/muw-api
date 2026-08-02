package common

type DatabaseType string

const (
	DatabaseTypeMySQL      DatabaseType = "mysql"
	DatabaseTypeSQLite     DatabaseType = "sqlite"
	DatabaseTypePostgreSQL DatabaseType = "postgres"
	DatabaseTypeClickHouse DatabaseType = "clickhouse"
)

var mainDatabaseType = DatabaseTypeSQLite
var logDatabaseType = DatabaseTypeSQLite

func MainDatabaseType() DatabaseType {
	return mainDatabaseType
}

func LogDatabaseType() DatabaseType {
	return logDatabaseType
}

func SetMainDatabaseType(databaseType DatabaseType) {
	mainDatabaseType = databaseType
}

func SetLogDatabaseType(databaseType DatabaseType) {
	logDatabaseType = databaseType
}

func SetDatabaseTypes(mainType DatabaseType, logType DatabaseType) {
	mainDatabaseType = mainType
	logDatabaseType = logType
}

func UsingMainDatabase(databaseType DatabaseType) bool {
	return mainDatabaseType == databaseType
}

func UsingLogDatabase(databaseType DatabaseType) bool {
	return logDatabaseType == databaseType
}

// SQLitePath defaults to WAL journal mode so readers are not blocked by the
// single writer, plus a 30s busy timeout. The pure-Go driver (modernc.org/sqlite)
// only honors `_pragma` DSN parameters (a plain `_busy_timeout` is ignored).
//
// `_txlock=immediate` is required for concurrent correctness: without it, a
// transaction that first SELECTs (establishing a read snapshot) and then writes
// can hit SQLITE_BUSY_SNAPSHOT when another connection commits in between, and
// the busy handler does not cover that case — the write fails instantly. BEGIN
// IMMEDIATE takes the write lock up front, so writers serialize via the busy
// timeout instead of dying on a stale snapshot. Autocommit SELECTs stay
// concurrent because WAL keeps readers unlocked.
var SQLitePath = "one-api.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"
