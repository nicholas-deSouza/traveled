import { runtimeService } from '../_shared/runtime.ts';
import { createWorkerHandler } from './handler.ts';
Deno.serve(createWorkerHandler(runtimeService()));
