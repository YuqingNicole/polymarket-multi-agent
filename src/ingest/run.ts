import 'dotenv/config'
import { config } from '@/lib/config'
import { startIngest } from '@/lib/ingest/worker'

// Standalone ingestion runner (alternative to the in-process instrumentation
// hook). Keeps the process alive for live WS/polling.
startIngest()
  .then(() => console.log(`ingest started · mode=${config.DATA_SOURCE}`))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
