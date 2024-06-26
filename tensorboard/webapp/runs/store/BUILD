load("//tensorboard/defs:defs.bzl", "tf_ts_library")

package(default_visibility = ["//tensorboard:internal"])

licenses(["notice"])

tf_ts_library(
    name = "store",
    srcs = [
        "index.ts",
        "runs_reducers.ts",
    ],
    deps = [
        ":types",
        ":utils",
        "//tensorboard/webapp/app_routing",
        "//tensorboard/webapp/app_routing:namespaced_state_reducer_helper",
        "//tensorboard/webapp/app_routing:types",
        "//tensorboard/webapp/app_routing/actions",
        "//tensorboard/webapp/runs:types",
        "//tensorboard/webapp/runs/actions",
        "//tensorboard/webapp/types",
        "//tensorboard/webapp/types:ui",
        "//tensorboard/webapp/util:ngrx",
        "//tensorboard/webapp/widgets/data_table:types",
        "@npm//@ngrx/store",
    ],
)

tf_ts_library(
    name = "utils",
    srcs = ["utils.ts"],
    visibility = [
        "//tensorboard/webapp/runs:__subpackages__",
    ],
    deps = [
        ":types",
        "//tensorboard/webapp/runs:types",
    ],
)

tf_ts_library(
    name = "selectors",
    srcs = ["runs_selectors.ts"],
    deps = [
        ":types",
        ":utils",
        "//tensorboard/webapp/app_routing/store",
        "//tensorboard/webapp/hparams:types",
        "//tensorboard/webapp/hparams/_redux:hparams_selectors",
        "//tensorboard/webapp/runs:types",
        "//tensorboard/webapp/types",
        "//tensorboard/webapp/types:ui",
        "//tensorboard/webapp/widgets/data_table:types",
        "//tensorboard/webapp/widgets/data_table:utils",
        "@npm//@ngrx/store",
    ],
)

tf_ts_library(
    name = "types",
    srcs = [
        "runs_types.ts",
    ],
    deps = [
        "//tensorboard/webapp/app_routing:namespaced_state_reducer_helper",
        "//tensorboard/webapp/experiments:types",
        "//tensorboard/webapp/runs:types",
        "//tensorboard/webapp/runs/data_source",
        "//tensorboard/webapp/types",
        "//tensorboard/webapp/types:ui",
        "//tensorboard/webapp/widgets/data_table:types",
    ],
)

tf_ts_library(
    name = "testing",
    testonly = True,
    srcs = ["testing.ts"],
    deps = [
        ":types",
        "//tensorboard/webapp/runs:types",
        "//tensorboard/webapp/runs/data_source",
        "//tensorboard/webapp/types:ui",
        "//tensorboard/webapp/widgets/data_table:types",
    ],
)

tf_ts_library(
    name = "store_test",
    testonly = True,
    srcs = [
        "runs_reducers_test.ts",
        "runs_selectors_test.ts",
        "utils_test.ts",
    ],
    deps = [
        ":selectors",
        ":store",
        ":testing",
        ":types",
        ":utils",
        "//tensorboard/webapp:app_state",
        "//tensorboard/webapp/app_routing:testing",
        "//tensorboard/webapp/app_routing:types",
        "//tensorboard/webapp/app_routing/actions",
        "//tensorboard/webapp/app_routing/store:testing",
        "//tensorboard/webapp/hparams:testing",
        "//tensorboard/webapp/runs:types",
        "//tensorboard/webapp/runs/actions",
        "//tensorboard/webapp/runs/data_source",
        "//tensorboard/webapp/runs/data_source:testing",
        "//tensorboard/webapp/testing:lang",
        "//tensorboard/webapp/testing:utils",
        "//tensorboard/webapp/types",
        "//tensorboard/webapp/types:ui",
        "//tensorboard/webapp/widgets/data_table:types",
        "@npm//@types/jasmine",
    ],
)
