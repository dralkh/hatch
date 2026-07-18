import { init } from "@instantdb/react";

import schema from "../instant.schema";

export const INSTANT_APP_ID = "6e7b29f1-4ec1-4356-9e12-ad4d421b7102";
export const instant = init({ appId: INSTANT_APP_ID, schema });
