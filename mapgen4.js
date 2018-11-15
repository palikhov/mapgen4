/*
 * From http://www.redblobgames.com/maps/mapgen4/
 * Copyright 2018 Red Blob Games <redblobgames@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const param       = require('./config');
const WebWorkify  = require('webworkify');
const MakeMesh    = require('./mesh');
const Map         = require('./map');
const Painting    = require('./painting');
const Render      = require('./render');


const initialParams = {
    elevation: [
        ['seed', 187, 1, 1 << 30],
        ['island', 0.5, 0, 1],
        ['noisy_coastlines', 0.01, 0, 0.1],
        ['hill_height', 0.02, 0, 0.1],
        ['mountain_jagged', 0, 0, 1],
        ['ocean_depth', 1.5, 1, 3],
    ],
    biomes: [
        ['wind_angle_deg', 0, 0, 360],
        ['raininess', 0.9, 0, 2],
        ['rain_shadow', 0.5, 0.1, 2],
        ['evaporation', 0.5, 0, 1],
    ],
    rivers: [
        ['lg_min_flow', 2.7, -5, 5],
        ['lg_river_width', -2.7, -5, 5],
        ['flow', 0.2, 0, 1],
    ],
    render: [
        ['zoom', 100/480, 100/1000, 100/50],
        ['x', 500, 0, 1000],
        ['y', 500, 0, 1000],
        ['light_angle_deg', 80, 0, 360],
        ['slope', 2, 0, 5],
        ['flat', 2.5, 0, 5],
        ['ambient', 0.25, 0, 1],
        ['overhead', 30, 0, 60],
        ['tilt_deg', 0, 0, 90],
        ['rotate_deg', 0, -180, 180],
        ['mountain_height', 50, 0, 250],
        ['outline_depth', 1, 0, 2],
        ['outline_strength', 15, 0, 30],
        ['outline_threshold', 0, 0, 100],
        ['outline_coast', 0, 0, 5],
        ['outline_water', 10.0, 0, 20], // things start going wrong when this is high
        ['biome_colors', 1, 0, 1],
    ],
};

    
/** @typedef { import("./types").Mesh } Mesh */

/**
 * Starts the UI, once the mesh has been loaded in.
 *
 * @param {{mesh: Mesh, peaks_t: number[]}} _
 */
function main({mesh, peaks_t}) {
    let render = new Render.Renderer(mesh);

    /* set initial parameters */
    for (let phase of ['elevation', 'biomes', 'rivers', 'render']) {
        const container = document.createElement('div');
        const header = document.createElement('h3');
        header.appendChild(document.createTextNode(phase));
        container.appendChild(header);
        document.getElementById('sliders').appendChild(container);
        for (let [name, initialValue, min, max] of initialParams[phase]) {
            param[phase][name] = initialValue;

            let span = document.createElement('span');
            span.appendChild(document.createTextNode(name));
            
            let slider = document.createElement('input');
            slider.setAttribute('type', 'range');
            slider.setAttribute('min', min);
            slider.setAttribute('max', max);
            slider.setAttribute('step', 0.01);
            slider.addEventListener('input', event => {
                param[phase][name] = slider.valueAsNumber;
                requestAnimationFrame(() => {
                    if (phase == 'render') { redraw(); }
                    else { generate(); }
                });
            });

            let label = document.createElement('label');
            label.appendChild(span);
            label.appendChild(slider);

            container.appendChild(label);
            slider.value = initialValue;
        }
    }
    
    function redraw() {
        render.updateView(param.render);
    }

    Painting.screenToWorldCoords = (coords) => {
        let out = render.screenToWorld(coords);
        return [out[0] / 1000, out[1] / 1000];
    };

    Painting.onUpdate = () => {
        generate();
    };

    const worker = /** @type {Worker} */(WebWorkify(require('./worker.js')));
    let working = false;
    let workRequested = false;
    let elapsedTimeHistory = [];

    worker.addEventListener('messageerror', event => {
        console.log("WORKER ERROR", event);
    });
    
    worker.addEventListener('message', event => {
        working = false;
        let {elapsed, numRiverTriangles, quad_elements_buffer, a_quad_em_buffer, a_river_xyuv_buffer} = event.data;
        elapsedTimeHistory.push(elapsed | 0);
        if (elapsedTimeHistory.length > 10) { elapsedTimeHistory.splice(0, 1); }
        document.getElementById('timing').innerText = `${elapsedTimeHistory.join(' ')} milliseconds`;
        render.quad_elements = new Int32Array(quad_elements_buffer);
        render.a_quad_em = new Float32Array(a_quad_em_buffer);
        render.a_river_xyuv = new Float32Array(a_river_xyuv_buffer);
        render.numRiverTriangles = numRiverTriangles;
        render.updateMap();
        redraw();
        if (workRequested) {
            requestAnimationFrame(() => {
                workRequested = false;
                generate();
            });
        }
    });

    function generate() {
        if (!working) {
            working = true;
            Painting.setElevationParam(param.elevation);
            worker.postMessage({
                param,
                constraints: {
                    size: Painting.size,
                    constraints: Painting.constraints,
                },
                quad_elements_buffer: render.quad_elements.buffer,
                a_quad_em_buffer: render.a_quad_em.buffer,
                a_river_xyuv_buffer: render.a_river_xyuv.buffer,
            }, [
                render.quad_elements.buffer,
                render.a_quad_em.buffer,
                render.a_river_xyuv.buffer,
            ]
                              );
        } else {
            workRequested = true;
        }
    }

    worker.postMessage({mesh, peaks_t, param});
    generate();
}

MakeMesh.makeMesh().then(main);

