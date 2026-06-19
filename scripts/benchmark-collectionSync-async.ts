import { performance } from 'perf_hooks';

// Simulate a network/IO delay of 10ms
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createCollectionFromBookmark() {
  await delay(10);
}

async function syncCollection() {
  await delay(10);
}

// Sequential version
async function syncCollectionsSequential(items: any[]) {
  for (const item of items) {
    if (item.isNew) {
      await createCollectionFromBookmark();
    } else {
      await syncCollection();
    }
  }
}

// Concurrent version
async function syncCollectionsConcurrent(items: any[]) {
  const promises = items.map((item) => {
    if (item.isNew) {
      return createCollectionFromBookmark();
    } else {
      return syncCollection();
    }
  });
  await Promise.all(promises);
}

async function runBenchmark() {
  const NUM_ITEMS = 50;
  const items = Array.from({ length: NUM_ITEMS }, (_, i) => ({
    id: i,
    isNew: i % 2 === 0,
  }));

  console.log(
    `Starting Async Benchmark with ${NUM_ITEMS} items (10ms delay each)...`
  );

  const startSeq = performance.now();
  await syncCollectionsSequential(items);
  const endSeq = performance.now();

  const startConc = performance.now();
  await syncCollectionsConcurrent(items);
  const endConc = performance.now();

  console.log(
    `Sequential execution time: ${(endSeq - startSeq).toFixed(2)} ms`
  );
  console.log(
    `Concurrent execution time: ${(endConc - startConc).toFixed(2)} ms`
  );
  console.log(
    `Speedup: ${((endSeq - startSeq) / (endConc - startConc)).toFixed(2)}x`
  );
}

runBenchmark().catch(console.error);
