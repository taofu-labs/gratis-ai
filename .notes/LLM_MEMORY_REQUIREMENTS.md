# LLM Memory Requirements Reference

Calculated 2026-02-22; browser-runtime notes refreshed 2026-08-22. All sizes in GiB (1 GiB = 1024^3 bytes).

## Formulas Used

- **File size** = (parameters x bits_per_weight) / 8 + overhead
- **KV cache** = 2 x num_layers x num_kv_heads x head_dim x context_length x bytes_per_element
- **Total memory** = model file + KV cache + runtime overhead (~0.3-0.5 GiB)

## Key Takeaways

- KV cache at long contexts can rival or exceed model weight size (e.g., 70B at 32K ctx = 10 GiB KV in FP16)
- Quantized KV caches reduce overhead, but support and stability vary by backend. gratisAI starts browser inference with F16 KV cache.
- wllama64's Memory64 runtime has a 16 GiB virtual ceiling; gratisAI limits model budget to 15 GB and further caps it by reported device memory.
- The locally hosted wasm32 compatibility runtime keeps the older ~3.4 GiB practical ceiling and is substantially slower.
- Browser selection starts at 2K context; catalog models grow within budget up to 16K at load. Advertised 128K/262K contexts are not startup allocations.
- OPFS streams model weights to disk, so downloads do not require a second model-sized in-memory Blob. Runtime weights, KV cache, and buffers must still fit.
- For 8 GiB devices, medium models leave safer operating-system headroom; a 7-8B Q4 model is a tight native-runtime choice at short context.
- For 24 GiB devices, 14B Q4/Q5 models are comfortable; 32B Q4 is near the limit and needs backend-specific validation.
