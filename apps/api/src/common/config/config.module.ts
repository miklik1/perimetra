import { Global, Module } from "@nestjs/common";

import { ENV, loadEnv } from "./env.js";

/** Global provider of the parsed env — inject with `@Inject(ENV) env: Env`. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadEnv }],
  exports: [ENV],
})
export class ConfigModule {}
