#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CodeGeneratorRequest, CodeGeneratorResponse, CodeGeneratorResponseError } from 'protoc-plugin';
import { Config } from './config';
import { Proto } from './input/proto';
import { Logger } from './logger';
import { PbFile } from './output/files/pb-file';
import { PbConfFile } from './output/files/pbconf-file';
import { PbscFile } from './output/files/pbsc-file';
import { PbwscFile } from './output/files/pbwsc-file';
import { Printer } from './output/misc/printer';
import { Services } from './services';

function main() {
  CodeGeneratorRequest()
    .then(r => {
      const protocInput = r.toObject()
      const filesToGenerate = protocInput.protoFileList;
      const protos = filesToGenerate.map(proto => new Proto(proto));

      Services.Config = Config.fromParameter(protocInput.parameter);
      Services.Logger = new Logger();

      if (Services.Config.debug) {
        mkdirSync('debug', { recursive: true });
        writeFileSync(join('debug', 'protoc-input.json'), JSON.stringify(protocInput, null, 2), 'utf-8');
        writeFileSync(join('debug', 'parsed-protoc-gen-ng.json'), JSON.stringify(protos, null, 2), 'utf-8');
      }

      protos.forEach(p => {
        p.resolved.dependencies = p.dependencyList.map(d => protos.find(pp => pp.name === d) as Proto);
        p.resolved.publicDependencies = p.publicDependencyList.map(i => p.resolved.dependencies[i]);
      });

      // TODO add cascade public import. Currently works with one-level only
      protos
        .filter(p => p.resolved.publicDependencies.length)
        .forEach(protoWithPublicImport =>
          protos
            .filter(pp => pp.resolved.dependencies.includes(protoWithPublicImport))
            .forEach(protoImportingProtoWithPublicImport => {
              Services.Logger.debug(`${protoImportingProtoWithPublicImport.name} reimports ${protoWithPublicImport.resolved.publicDependencies.map(p => p.name).join(', ')} via ${protoWithPublicImport.name}`);

              protoImportingProtoWithPublicImport.resolved.dependencies.push(...protoWithPublicImport.resolved.publicDependencies)
            })
        );

      return protos.reduce((res, proto) => {
        const basename = proto.getGeneratedFileBaseName();
        const files: any[] = [];

        if (proto.serviceList.length) {
          const configPrinter = new Printer();
          const configFile = new PbConfFile(proto);

          configFile.print(configPrinter);

          files.push({ name: basename + 'conf.ts', content: configPrinter.finalize() });

          const pbscPrinter = new Printer();
          const pbscFile = new PbscFile(proto);

          pbscFile.print(pbscPrinter);

          files.push({ name: basename + 'sc.ts', content: pbscPrinter.finalize() });

          if (Services.Config.worker) {
            const pbwscPrinter = new Printer();
            const pbwscFile = new PbwscFile(proto);

            pbwscFile.print(pbwscPrinter);

            files.push({ name: basename + 'wsc.ts', content: pbwscPrinter.finalize() });
          }
        }

        const pbPrinter = new Printer();
        const pbFile = new PbFile(proto);

        pbFile.print(pbPrinter);

        files.push({ name: basename + '.ts', content: pbPrinter.finalize() });

        return [...res, ...files];
      }, [] as any[]);
    })
    .then(CodeGeneratorResponse())
    .catch(CodeGeneratorResponseError())
}

main();
