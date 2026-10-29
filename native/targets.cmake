find_package(nlohmann_json REQUIRED)
find_package(ZLIB REQUIRED)
# Only these independent adapters need C++17; ART remains at its existing C++11.
if(MSVC)
  set(CAPTRAW_ENHANCED_CXX17 "/std:c++17")
else()
  set(CAPTRAW_ENHANCED_CXX17 "-std=c++17")
endif()
set_source_files_properties("${CAPTRAW_SOURCE_DIR}/enhanced-table.cc"
  "${CAPTRAW_SOURCE_DIR}/enhanced-profile.cc" "${CAPTRAW_SOURCE_DIR}/enhanced-art.cc"
  DIRECTORY "${CMAKE_SOURCE_DIR}/src/engine"
  PROPERTIES COMPILE_OPTIONS "${CAPTRAW_ENHANCED_CXX17}")
pkg_check_modules(CAPTRAW_AVIF REQUIRED IMPORTED_TARGET libavif>=1.4.2)
target_sources(art_engine PRIVATE "${CAPTRAW_SOURCE_DIR}/grading.cc" "${CAPTRAW_SOURCE_DIR}/preview-crop.cc" "${CAPTRAW_SOURCE_DIR}/geometry-map.cc" "${CAPTRAW_SOURCE_DIR}/geometry-field.cc" "${CAPTRAW_SOURCE_DIR}/source-frame.cc" "${CAPTRAW_SOURCE_DIR}/repair.cc" "${CAPTRAW_SOURCE_DIR}/effects.cc" "${CAPTRAW_SOURCE_DIR}/brush.cc"
  "${CAPTRAW_SOURCE_DIR}/enhanced-table.cc" "${CAPTRAW_SOURCE_DIR}/enhanced-profile.cc" "${CAPTRAW_SOURCE_DIR}/enhanced-art.cc")
cmake_policy(PUSH)
cmake_policy(SET CMP0079 NEW)
target_link_libraries(art_engine nlohmann_json::nlohmann_json ZLIB::ZLIB)
cmake_policy(POP)
target_include_directories(art_engine PRIVATE "${CMAKE_SOURCE_DIR}/src" "${CAPTRAW_SOURCE_DIR}")
include_directories(${GTKMM_INCLUDE_DIRS} ${GTK_INCLUDE_DIRS} ${CAIROMM_INCLUDE_DIRS}
  ${GIOMM_INCLUDE_DIRS} ${GIO_INCLUDE_DIRS} ${GLIBMM_INCLUDE_DIRS} ${GLIB2_INCLUDE_DIRS}
  ${SIGC_INCLUDE_DIRS} ${EXIV2_INCLUDE_DIRS} ${LCMS_INCLUDE_DIRS} ${FFTW3F_INCLUDE_DIRS}
  ${PNG_INCLUDE_DIRS} ${LENSFUN_INCLUDE_DIRS}
  "${CMAKE_SOURCE_DIR}/src" "${CMAKE_BINARY_DIR}/src/utils" "${CAPTRAW_SOURCE_DIR}")
link_directories(${GTKMM_LIBRARY_DIRS} ${GIOMM_LIBRARY_DIRS} ${GIO_LIBRARY_DIRS}
  ${CAIROMM_LIBRARY_DIRS} ${GLIBMM_LIBRARY_DIRS} ${GLIB2_LIBRARY_DIRS})
set(CAPTRAW_SUPPORT
  "${CMAKE_SOURCE_DIR}/src/gui/alignedmalloc.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/edit.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/options.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/paramsedited.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/exiffiltersettings.cc")
add_library(captraw-core STATIC ${CAPTRAW_SUPPORT}
  "${CAPTRAW_SOURCE_DIR}/tat-sample.cc"
  "${CAPTRAW_SOURCE_DIR}/core.cc" "${CAPTRAW_SOURCE_DIR}/recipe.cc" "${CAPTRAW_SOURCE_DIR}/repair-recipe.cc" "${CAPTRAW_SOURCE_DIR}/repair-source.cc" "${CAPTRAW_SOURCE_DIR}/white-balance.cc"
  "${CAPTRAW_SOURCE_DIR}/hdr-avif.cc" "${CAPTRAW_SOURCE_DIR}/input-profile.cc" "${CAPTRAW_SOURCE_DIR}/float-preview.cc" "${CAPTRAW_SOURCE_DIR}/output-metadata.cc")
target_compile_features(captraw-core PUBLIC cxx_std_17)
target_link_libraries(captraw-core PUBLIC PkgConfig::CAPTRAW_AVIF art_engine art_utils nlohmann_json::nlohmann_json
  ${CAIROMM_LIBRARIES} ${GIOMM_LIBRARIES} ${GIO_LIBRARIES} ${GTKMM_LIBRARIES}
  ${RSVG_LIBRARIES} ${EXIV2_LIBRARIES})
add_executable(captraw-engine "${CAPTRAW_SOURCE_DIR}/worker.cc")
set(CAPTRAW_CONTRACT_SOURCE "${CAPTRAW_SOURCE_DIR}/../packages/contracts/index.ts")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CAPTRAW_CONTRACT_SOURCE}")
file(STRINGS "${CAPTRAW_CONTRACT_SOURCE}" CAPTRAW_VERSION_DECLARATION
  REGEX "^export const ENGINE_VERSION='[^']+';")
list(LENGTH CAPTRAW_VERSION_DECLARATION CAPTRAW_VERSION_COUNT)
if(NOT CAPTRAW_VERSION_COUNT EQUAL 1)
  message(FATAL_ERROR "Expected one canonical CaptRAW processing version")
endif()
string(REGEX REPLACE "^export const ENGINE_VERSION='([^']+)'.*$" "\\1"
  CAPTRAW_ENGINE_VERSION "${CAPTRAW_VERSION_DECLARATION}")
target_compile_definitions(captraw-engine PRIVATE CAPTRAW_ENGINE_VERSION="${CAPTRAW_ENGINE_VERSION}")
target_compile_features(captraw-engine PUBLIC cxx_std_17)
target_link_libraries(captraw-engine PRIVATE captraw-core)
add_executable(captraw-wb-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/white-balance-probe.cc")
add_executable(captraw-enhanced-table-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/enhanced-table-probe.cc" "${CAPTRAW_SOURCE_DIR}/enhanced-table.cc" "${CAPTRAW_SOURCE_DIR}/enhanced-profile.cc")
target_compile_features(captraw-enhanced-table-probe PRIVATE cxx_std_17)
target_link_libraries(captraw-enhanced-table-probe PRIVATE nlohmann_json::nlohmann_json ZLIB::ZLIB ${GLIB2_LIBRARIES})
target_link_libraries(captraw-wb-probe PRIVATE captraw-core)
add_executable(captraw-geometry-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/geometry-probe.cc")
target_link_libraries(captraw-geometry-probe PRIVATE captraw-core)
add_executable(captraw-auto-crop-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/auto-crop-probe.cc")
target_link_libraries(captraw-auto-crop-probe PRIVATE captraw-core)
add_executable(captraw-mask-geometry-probe EXCLUDE_FROM_ALL "${CAPTRAW_SOURCE_DIR}/../tests/mask-geometry-probe.cc")
target_link_libraries(captraw-mask-geometry-probe PRIVATE captraw-core)
add_executable(captraw-art-reference ${CAPTRAW_SUPPORT}
  "${CMAKE_SOURCE_DIR}/src/gui/main-cli.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/fastexport.cc"
  "${CMAKE_SOURCE_DIR}/src/gui/makeicc.cc")
target_link_libraries(captraw-art-reference PRIVATE art_engine art_utils
  ${CAIROMM_LIBRARIES} ${GIOMM_LIBRARIES} ${GIO_LIBRARIES} ${GTKMM_LIBRARIES}
  ${RSVG_LIBRARIES} ${EXIV2_LIBRARIES})
if(APPLE)
  target_link_libraries(captraw-wb-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-geometry-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-auto-crop-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-mask-geometry-probe PRIVATE "-framework Foundation")
  target_link_libraries(captraw-engine PRIVATE "-framework Foundation")
  target_link_libraries(captraw-art-reference PRIVATE "-framework Foundation")
endif()
