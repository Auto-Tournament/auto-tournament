# Benchmark demo

`bench.dem` here is the benchmark every recorder plays: a short GOTV demo of
one human killing a bot (de_dust2), recorded for Auto Tournament. The worker
embeds it and times one clip of the first kill (benchmark_linux.go
bundledBenchmark), so every recorder is timed on the same clip and a new
install can be benchmarked before it has recorded anything.

Without `bench.dem` the worker falls back to the platform's benchmark moment
(the first clip recorded on that install).
